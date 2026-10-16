import SafariServices

// Native messaging endpoint shared by the macOS and iOS extension targets.
// Keychain messages are handled by KeychainBridge (T004).
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey]
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: KeychainBridge.handle(message)]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
