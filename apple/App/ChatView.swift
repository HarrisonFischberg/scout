#if os(iOS)
import SwiftUI
import UIKit
import WebKit

// The Scout app's own chat (owner request 2026-11-01): open the app and ask
// Claude anything, no Safari needed. The screen is the web page built from
// src/app/chat.ts (npm run build puts it in App/Chat), so answers, sources and
// the provider code are the same as Scout's panel in Safari. This view is only
// the frame: a web view and a small bridge for the Keychain key (shared with
// the Safari extension), Apple's on-device model, and opening setup.
struct ChatScreen: View {
    var onSetup: () -> Void

    var body: some View {
        ChatWebView(onSetup: onSetup)
            // The page pads itself with the safe-area insets (viewport-fit=cover).
            .ignoresSafeArea(.container)
            .background(Color.trailCanvas.ignoresSafeArea())
    }
}

struct ChatWebView: UIViewRepresentable {
    var onSetup: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onSetup: onSetup) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.addScriptMessageHandler(context.coordinator, contentWorld: .page, name: "scout")
        // Saved chats live in the page's local storage, on this device only.
        config.websiteDataStore = .default()
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        web.isOpaque = false
        web.backgroundColor = .clear
        web.scrollView.backgroundColor = .clear
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.bounces = false
        web.allowsLinkPreview = false
        web.accessibilityIdentifier = "scout-chat"
        #if DEBUG
        if #available(iOS 16.4, *) { web.isInspectable = true }
        #endif
        if let page = Bundle.main.url(forResource: "chat", withExtension: "html", subdirectory: "Chat") {
            web.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
        }
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        context.coordinator.onSetup = onSetup
    }

    static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) {
        web.configuration.userContentController.removeScriptMessageHandler(forName: "scout", contentWorld: .page)
    }

    final class Coordinator: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKUIDelegate {
        var onSetup: () -> Void
        /// Only the provider keys; the extension's own markers stay out of reach of the page.
        static let accounts: Set<String> = ["anthropic", "openai"]

        init(onSetup: @escaping () -> Void) {
            self.onSetup = onSetup
        }

        func userContentController(_ userContentController: WKUserContentController,
                                   didReceive message: WKScriptMessage,
                                   replyHandler: @escaping (Any?, String?) -> Void) {
            // Only the app's own bundled page may use the bridge.
            guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.isFileURL == true else {
                replyHandler(["ok": false, "error": "denied"], nil)
                return
            }
            let body = message.body
            let fields = body as? [String: Any]
            let type = fields?["type"] as? String ?? ""
            if type == "app.setup" {
                onSetup()
                replyHandler(["ok": true], nil)
                return
            }
            if AppleModelBridge.handles(body) {
                Task { @MainActor in
                    replyHandler(await AppleModelBridge.handle(body), nil)
                }
                return
            }
            guard type.hasPrefix("keychain."), let account = fields?["account"] as? String, Self.accounts.contains(account) else {
                replyHandler(["ok": false, "error": "bad_request"], nil)
                return
            }
            replyHandler(KeychainBridge.handle(body), nil)
        }

        // The page never navigates away; web links (sources, policies) open in Safari.
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { return decisionHandler(.cancel) }
            if url.isFileURL { return decisionHandler(.allow) }
            Self.openOutside(url)
            decisionHandler(.cancel)
        }

        // target="_blank" links ask for a new window: open them in Safari instead.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url { Self.openOutside(url) }
            return nil
        }

        // confirm() for "Remove key" and "Delete all chats".
        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            guard let presenter = webView.window?.rootViewController?.topmostPresented else { return completionHandler(false) }
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "OK", style: .destructive) { _ in completionHandler(true) })
            presenter.present(alert, animated: true)
        }

        // The web content process can be ended by iOS while the app is in the background.
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }

        private static func openOutside(_ url: URL) {
            guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else { return }
            UIApplication.shared.open(url)
        }
    }
}

private extension UIViewController {
    var topmostPresented: UIViewController {
        presentedViewController?.topmostPresented ?? self
    }
}
#endif
