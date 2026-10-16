import SafariServices
import os

// Native messaging endpoint shared by the macOS and iOS extension targets.
// Keychain messages are handled by KeychainBridge (T004).
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey]
        #if DEBUG
        // Diagnostics for supervised Simulator runs: stage names only, never
        // page text, keys, or user input. Compiled out of release builds.
        if let m = message as? [String: Any], m["type"] as? String == "debug.stage",
           let stage = m["stage"] as? String {
            Logger(subsystem: "com.example.SafariScout", category: "stage").debug("stage \(stage, privacy: .public)")
            let ok = NSExtensionItem()
            ok.userInfo = [SFExtensionMessageKey: ["ok": true]]
            context.completeRequest(returningItems: [ok], completionHandler: nil)
            return
        }
        #endif
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: KeychainBridge.handle(message)]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
