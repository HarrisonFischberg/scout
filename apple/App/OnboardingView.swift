import SwiftUI
#if os(macOS)
import SafariServices
#endif

// S01 (macOS) / S02 (iOS): enable the extension. S03: provider + key.
struct OnboardingView: View {
    // Must match PRODUCT_BUNDLE_IDENTIFIER of the extension targets.
    private let extensionBundleIdentifier = "com.example.AssistAnt.Extension"
    @StateObject private var setup = SetupViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Set up AssistAnt")
                    .font(.largeTitle.bold())
                    .accessibilityAddTraits(.isHeader)
                enableSection
                keySection
            }
            .padding(24)
            .frame(maxWidth: 560, alignment: .leading)
        }
    }

    private var enableSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("1. Turn on the extension")
                .font(.title2.bold())
                .accessibilityAddTraits(.isHeader)
            #if os(macOS)
            Text("Open Safari extension settings, then switch on AssistAnt.")
            Button("Open Safari Extension Settings") {
                SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { _ in }
            }
            #else
            Text("Open the Settings app. Go to Apps, then Safari, then Extensions. Switch on AssistAnt and allow it on the websites you choose.")
            #endif
        }
    }

    private var keySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("2. Add your API key")
                .font(.title2.bold())
                .accessibilityAddTraits(.isHeader)
            Text("AssistAnt sends page content to the provider you choose, using your own key. The key is stored in Keychain on this device.")
            Picker("Provider", selection: $setup.provider) {
                ForEach(Provider.allCases) { Text($0.displayName).tag($0) }
            }
            .pickerStyle(.segmented)
            SecureField("API key", text: $setup.key)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .accessibilityHint("Paste the key from your provider account")
            HStack {
                Button("Test key") { Task { await setup.testKey() } }
                    .disabled(!setup.canTest)
                Button("Save key") { setup.save() }
                    .disabled(setup.state != .result(.valid))
                    .buttonStyle(.borderedProminent)
            }
            // Status is text, never colour alone.
            Text(setup.statusMessage)
                .accessibilityLabel("Key status: \(setup.statusMessage)")
        }
    }
}

#Preview {
    OnboardingView()
}
