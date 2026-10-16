import SafariServices

// Native messaging endpoint shared by the macOS and iOS extension targets.
// T002 stub: answers every message with ok. Keychain bridge arrives in T004.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let reply: [String: Any] = ["ok": true]
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: reply]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
