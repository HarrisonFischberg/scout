import SwiftUI
#if os(macOS)
import SafariServices
#endif

// S01 (macOS) / S02 (iOS): enable the extension. S03: provider + key.
struct OnboardingView: View {
    // Must match PRODUCT_BUNDLE_IDENTIFIER of the extension targets.
    private let extensionBundleIdentifier = "com.example.SafariScout.Extension"
    @StateObject private var setup = SetupViewModel()
    @State fileprivate var showing: LegalDoc?

    fileprivate enum LegalDoc: String, Identifiable {
        case privacy, terms
        var id: String { rawValue }
        var title: String { self == .privacy ? "Privacy policy (draft)" : "Terms of service (draft)" }
        var resource: String { self == .privacy ? "privacy-policy" : "terms" }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Set up Safari Scout")
                    .font(.largeTitle.bold())
                    .accessibilityAddTraits(.isHeader)
                Text("Your AI assistant in the world wide Safari")
                    .font(.title3)
                    .foregroundStyle(.secondary)
                enableSection
                keySection
                legalSection
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
            Text("Open Safari extension settings, then switch on Safari Scout.")
            Button("Open Safari Extension Settings") {
                SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { _ in }
            }
            #else
            Text("Open the Settings app. Go to Apps, then Safari, then Extensions. Switch on Safari Scout and allow it on the websites you choose.")
            #endif
        }
    }

    private var keySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("2. Add your API key")
                .font(.title2.bold())
                .accessibilityAddTraits(.isHeader)
            Text("Safari Scout sends page content to the provider you choose, using your own key. The key is stored in Keychain on this device.")
            Text("Your provider bills your account for every request Safari Scout makes, at the provider's prices. Safari Scout shows an estimated cost after each answer or task.")
            #if os(macOS)
            // On Mac the app and the extension do not share a Keychain group yet
            // (launch-blockers 14), so the key is added in Safari, where the
            // extension stores it itself.
            Text("On Mac, add your key in Safari: click the Safari Scout icon in the toolbar, then Settings.")
                .bold()
            #endif
            #if os(iOS)
            Picker("Provider", selection: $setup.provider) {
                ForEach(Provider.allCases) { Text($0.displayName).tag($0) }
            }
            .pickerStyle(.segmented)
            SecureField("API key", text: $setup.key)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .accessibilityHint("Paste the key from your provider account")
            HStack {
                // Always enabled: a press that cannot proceed explains why
                // in the status line below instead of greying the button out.
                Button("Test key") { Task { await setup.testKey() } }
                Button("Save key") { setup.save() }
                    .buttonStyle(AccentButtonStyle())
            }
            // Status is text, never colour alone.
            Text(setup.statusMessage)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel("Key status: \(setup.statusMessage)")
            #endif
        }
    }
}

// S09: privacy policy and terms drafts. Reads docs/legal/*.md copied into the
// app bundle (added to both App targets by scripts/add-ui-test-target.rb).
private struct LegalDocView: View {
    let title: String
    let resource: String
    @Environment(\.dismiss) private var dismiss

    private var text: String {
        guard let url = Bundle.main.url(forResource: resource, withExtension: "md"),
              let body = try? String(contentsOf: url, encoding: .utf8) else {
            return "This draft is not bundled in this build."
        }
        return body
    }

    // Minimal Markdown rendering for the bundled drafts: headings, block
    // quotes, and paragraphs; inline emphasis and code via AttributedString.
    static func blocks(_ markdown: String) -> [Text] {
        let paragraphs = markdown.components(separatedBy: "\n\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return paragraphs.map { para in
            func inline(_ s: String) -> Text {
                let joined = s.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.joined(separator: " ")
                let opts = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
                return Text((try? AttributedString(markdown: joined, options: opts)) ?? AttributedString(joined))
            }
            let lines = para.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }
            func lineByLine(_ items: [String]) -> Text {
                let opts = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
                let joined = items.joined(separator: "\n")
                return Text((try? AttributedString(markdown: joined, options: opts)) ?? AttributedString(joined))
            }
            // Table: one line per data row, "first cell: other cells".
            if lines.allSatisfy({ $0.hasPrefix("|") }) {
                let rows = lines.dropFirst().filter { !$0.replacingOccurrences(of: "|", with: "").allSatisfy { "-: ".contains($0) } }
                return lineByLine(rows.map { row in
                    let cells = row.split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }
                    return "• **\(cells.first ?? "")**: " + cells.dropFirst().joined(separator: "; ")
                })
            }
            // Bullet list: keep one item per line.
            if lines.allSatisfy({ $0.hasPrefix("- ") || $0.hasPrefix("* ") || $0.hasPrefix("  ") }) && lines.first.map({ $0.hasPrefix("- ") || $0.hasPrefix("* ") }) == true {
                return lineByLine(lines.map { $0.hasPrefix("- ") || $0.hasPrefix("* ") ? "• " + $0.dropFirst(2) : $0 })
            }
            // "Label: value" field lines stay on their own lines.
            if lines.count > 1, lines.allSatisfy({ l in l.range(of: ": ").map { l.distance(from: l.startIndex, to: $0.lowerBound) < 60 } ?? false }) {
                return lineByLine(lines)
            }
            if para.hasPrefix("## ") { return inline(String(para.dropFirst(3))).font(.headline) }
            if para.hasPrefix("# ") { return inline(String(para.dropFirst(2))).font(.title3.bold()) }
            if para.hasPrefix(">") {
                let body = para.split(separator: "\n").map { $0.drop(while: { $0 == ">" || $0 == " " }) }.joined(separator: "\n")
                return inline(body).italic()
            }
            return inline(para)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline) {
                    Text(title)
                        .font(.title2.bold())
                        .accessibilityAddTraits(.isHeader)
                    Spacer()
                    // In-content close control (the system toolbar button failed
                    // the contrast and Dynamic Type audit). Escape / the cancel
                    // shortcut also dismiss, so the sheet is never a keyboard trap.
                    Button("Done") { dismiss() }
                        .buttonStyle(AccentButtonStyle())
                        .keyboardShortcut(.cancelAction)
                }
                Text("DRAFT. Not approved by legal review.").bold()
                ForEach(Array(Self.blocks(text).enumerated()), id: \.offset) { _, block in
                    block
                }
                .textSelection(.enabled)
            }
            .padding(24)
            .frame(maxWidth: 560, alignment: .leading)
        }
    }
}

extension OnboardingView {
    fileprivate var legalSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Legal (DRAFT)")
                .font(.title2.bold())
                .accessibilityAddTraits(.isHeader)
            Text("Drafts awaiting legal review. Not final.")
            Button("Privacy policy (draft)") { showing = .privacy }
            Button("Terms of service (draft)") { showing = .terms }
        }
        .sheet(item: $showing) { doc in
            LegalDocView(title: doc.title, resource: doc.resource)
        }
    }
}

#Preview {
    OnboardingView()
}
