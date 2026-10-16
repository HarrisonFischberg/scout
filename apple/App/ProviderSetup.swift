import Foundation

// Provider choice and key validation for onboarding (S03).
// The key goes to Keychain via KeychainStore and to the provider's own API only.
enum Provider: String, CaseIterable, Identifiable {
    case anthropic
    case openai

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .anthropic: return "Anthropic"
        case .openai: return "OpenAI"
        }
    }

    // Linked from the consent sheet before anything is sent to the provider.
    // OpenAI: the rest-of-world policy, which links to the EU/UK/CH and US
    // versions (same link as src/settings/consent.ts).
    var privacyPolicy: URL {
        switch self {
        case .anthropic: return URL(string: "https://www.anthropic.com/legal/privacy")!
        case .openai: return URL(string: "https://openai.com/policies/row-privacy-policy/")!
        }
    }

    // The privacy policies exclude content sent through the providers'
    // business offerings; requests with the user's own API key fall under
    // these terms, so the sheet links both (same as src/settings/consent.ts).
    var apiDataTerms: URL {
        switch self {
        case .anthropic: return URL(string: "https://www.anthropic.com/legal/commercial-terms")!
        case .openai: return URL(string: "https://openai.com/enterprise-privacy/")!
        }
    }

    // Read-only model list endpoint: cheap, no tokens billed.
    fileprivate var testRequest: URL {
        switch self {
        case .anthropic: return URL(string: "https://api.anthropic.com/v1/models")!
        case .openai: return URL(string: "https://api.openai.com/v1/models")!
        }
    }
}

enum KeyTestResult: Equatable {
    case valid
    case invalid
    case networkError
}

protocol KeyTesting {
    func test(key: String, provider: Provider) async -> KeyTestResult
}

struct ProviderKeyTester: KeyTesting {
    var session: URLSession = .shared

    func test(key: String, provider: Provider) async -> KeyTestResult {
        var request = URLRequest(url: provider.testRequest)
        request.timeoutInterval = 15
        switch provider {
        case .anthropic:
            request.setValue(key, forHTTPHeaderField: "x-api-key")
            request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        case .openai:
            request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        }
        do {
            let (_, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { return .networkError }
            switch http.statusCode {
            case 200..<300: return .valid
            case 401, 403: return .invalid
            default: return .networkError
            }
        } catch {
            return .networkError
        }
    }
}

// Permission to share with a third-party AI provider (App Store Review
// Guideline 5.1.2(i)), asked before "Test key" sends anything to it. The app
// keeps its own record per provider in UserDefaults. The Safari extension
// cannot read it, so Safari asks again before its first request
// (src/settings/consent.ts).
final class ConsentStore {
    /// Bump when what is shared changes, so everyone is asked again.
    static let version = 1
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    private func key(_ provider: Provider) -> String { "aiConsent.\(provider.rawValue)" }

    func has(_ provider: Provider) -> Bool { defaults.integer(forKey: key(provider)) == Self.version }
    func grant(_ provider: Provider) { defaults.set(Self.version, forKey: key(provider)) }
    func withdraw(_ provider: Provider) { defaults.removeObject(forKey: key(provider)) }
    func withdrawAll() { Provider.allCases.forEach(withdraw) }
}

enum SetupState: Equatable {
    case empty
    case testing
    case result(KeyTestResult)
    case saved
}

@MainActor
final class SetupViewModel: ObservableObject {
    // Switching provider shows that provider's own state. Before this, the
    // "saved" message from one provider stayed up after switching (T018).
    @Published var provider: Provider = .anthropic {
        didSet {
            guard provider != oldValue else { return }
            key = ""
            consentRequest = nil
            state = hasSavedKey(for: provider) ? .saved : .empty
            sharingAllowed = consent.has(provider)
        }
    }
    // Editing the key invalidates an earlier test result.
    @Published var key: String = "" {
        didSet {
            hint = nil
            if state != .testing && state != .saved { state = .empty }
        }
    }
    @Published private(set) var state: SetupState = .empty {
        didSet { hint = nil }
    }
    // Explains why a button did nothing. The buttons stay enabled (greyed-out
    // controls failed the contrast audit), so they must say what is missing.
    @Published private(set) var hint: String?
    // Set when "Test key" needs permission first; the view shows the consent sheet.
    @Published var consentRequest: Provider?
    // Whether the chosen provider may receive requests (shown with a Withdraw button).
    @Published private(set) var sharingAllowed = false

    private let tester: KeyTesting
    private let store: KeychainStore
    private let consent: ConsentStore

    init(tester: KeyTesting = ProviderKeyTester(), store: KeychainStore = KeychainStore(), consent: ConsentStore = ConsentStore()) {
        self.tester = tester
        self.store = store
        self.consent = consent
        state = hasSavedKey(for: provider) ? .saved : .empty
        sharingAllowed = consent.has(provider)
    }

    func hasSavedKey(for provider: Provider) -> Bool {
        ((try? store.get(account: provider.rawValue)) ?? nil) != nil
    }

    var canTest: Bool { !key.trimmingCharacters(in: .whitespaces).isEmpty && state != .testing }

    func testKey() async {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            hint = "Enter your \(provider.displayName) API key first."
            return
        }
        guard state != .testing else { return }
        // Nothing reaches the provider until the user allows it.
        guard consent.has(provider) else {
            consentRequest = provider
            return
        }
        state = .testing
        state = .result(await tester.test(key: trimmed, provider: provider))
    }

    // Consent sheet "Allow": remember it for this provider, then run the test.
    func allowSharing() async {
        guard let asked = consentRequest else { return }
        consent.grant(asked)
        consentRequest = nil
        sharingAllowed = consent.has(provider)
        if asked == provider { await testKey() }
    }

    // Consent sheet "Not now": nothing is sent or stored.
    func declineSharing() {
        guard let asked = consentRequest else { return }
        consentRequest = nil
        hint = "Nothing was sent. Safari Scout tests the key with \(asked.displayName) only after you allow sharing."
    }

    func withdrawSharing() {
        consent.withdraw(provider)
        sharingAllowed = false
        if case .result = state { state = .empty }
        hint = "Withdrawn. Safari Scout sends nothing to \(provider.displayName) from this app until you allow it again."
    }

    // Saves only after a valid test, then clears the in-memory field.
    func save() {
        guard state == .result(.valid) else {
            hint = state == .saved ? "Key already saved to Keychain." : "Test the key before saving."
            return
        }
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try store.set(trimmed, account: provider.rawValue)
            state = .saved
            key = ""
        } catch {
            state = .result(.networkError)
        }
    }

    var statusMessage: String {
        if let hint { return hint }
        switch state {
        case .empty: return "Enter your \(provider.displayName) API key."
        case .testing: return "Testing key…"
        case .result(.valid): return "Key is valid. Save it to Keychain."
        case .result(.invalid): return "\(provider.displayName) rejected this key. Check it and try again."
        case .result(.networkError): return "Could not reach \(provider.displayName). Check your connection and try again."
        case .saved: return "\(provider.displayName) key saved to Keychain."
        }
    }
}
