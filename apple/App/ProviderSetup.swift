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

enum SetupState: Equatable {
    case empty
    case testing
    case result(KeyTestResult)
    case saved
}

@MainActor
final class SetupViewModel: ObservableObject {
    @Published var provider: Provider = .anthropic
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

    private let tester: KeyTesting
    private let store: KeychainStore

    init(tester: KeyTesting = ProviderKeyTester(), store: KeychainStore = KeychainStore()) {
        self.tester = tester
        self.store = store
    }

    var canTest: Bool { !key.trimmingCharacters(in: .whitespaces).isEmpty && state != .testing }

    func testKey() async {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            hint = "Enter your \(provider.displayName) API key first."
            return
        }
        guard state != .testing else { return }
        state = .testing
        state = .result(await tester.test(key: trimmed, provider: provider))
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
        case .saved: return "Key saved to Keychain."
        }
    }
}
