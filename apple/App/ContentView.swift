import SwiftUI
#if os(macOS)
import SafariServices
#endif

// Placeholder host screen. Onboarding (S01–S03) arrives in T006.
struct ContentView: View {
    // Must match PRODUCT_BUNDLE_IDENTIFIER of the extension targets.
    private let extensionBundleIdentifier = "com.example.AssistAnt.Extension"

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("AssistAnt")
                .font(.title)
            Text("Turn on the AssistAnt extension in Safari to use it.")
            #if os(macOS)
            Button("Open Safari Extension Preferences") {
                SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { _ in }
            }
            #endif
        }
        .padding()
    }
}

#Preview {
    ContentView()
}
