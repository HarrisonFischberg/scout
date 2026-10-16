import XCTest

// ProviderSetup.swift and KeychainStore.swift compile into the test target directly.
// Stub tester and test-only Keychain service: no network, no real key.
@MainActor
final class ProviderSetupTests: XCTestCase {
    private struct StubTester: KeyTesting {
        let result: KeyTestResult
        func test(key: String, provider: Provider) async -> KeyTestResult { result }
    }

    // Counts calls, so a test can prove nothing reached the provider.
    private final class CountingTester: KeyTesting, @unchecked Sendable {
        private(set) var calls: [Provider] = []
        func test(key: String, provider: Provider) async -> KeyTestResult {
            calls.append(provider)
            return .valid
        }
    }

    private let store = KeychainStore(service: "com.example.SafariScout.tests.setup")
    private let consentSuite = "com.example.SafariScout.tests.consent"
    private var consent: ConsentStore { ConsentStore(defaults: UserDefaults(suiteName: consentSuite)!) }
    // Tests that are not about consent start with both providers allowed.
    private var allowed: ConsentStore {
        let c = consent
        Provider.allCases.forEach(c.grant)
        return c
    }

    override func tearDown() {
        for p in Provider.allCases { try? store.delete(account: p.rawValue) }
        UserDefaults(suiteName: consentSuite)?.removePersistentDomain(forName: consentSuite)
        super.tearDown()
    }

    func testValidKeyThenSave() async throws {
        let vm = SetupViewModel(tester: StubTester(result: .valid), store: store, consent: allowed)
        vm.key = "sk-test-synthetic-setup"
        await vm.testKey()
        XCTAssertEqual(vm.state, .result(.valid))
        vm.save()
        XCTAssertEqual(vm.state, .saved)
        XCTAssertEqual(vm.key, "")
        XCTAssertEqual(try store.get(account: "anthropic"), "sk-test-synthetic-setup")
    }

    func testInvalidKeyIsNotSaved() async throws {
        let vm = SetupViewModel(tester: StubTester(result: .invalid), store: store, consent: allowed)
        vm.key = "sk-test-synthetic-bad"
        await vm.testKey()
        XCTAssertEqual(vm.state, .result(.invalid))
        vm.save()
        XCTAssertNotEqual(vm.state, .saved)
        XCTAssertNil(try store.get(account: "anthropic"))
    }

    func testEditingKeyResetsResult() async {
        let vm = SetupViewModel(tester: StubTester(result: .valid), store: store, consent: allowed)
        vm.key = "sk-test-synthetic-a"
        await vm.testKey()
        vm.key = "sk-test-synthetic-b"
        XCTAssertEqual(vm.state, .empty)
    }

    func testEmptyKeyCannotTest() {
        let vm = SetupViewModel(tester: StubTester(result: .valid), store: store, consent: allowed)
        XCTAssertFalse(vm.canTest)
    }

    func testPressingTestWithEmptyKeyExplainsWhy() async {
        let vm = SetupViewModel(tester: StubTester(result: .valid), store: store, consent: allowed)
        await vm.testKey()
        XCTAssertEqual(vm.state, .empty)
        XCTAssertEqual(vm.statusMessage, "Enter your Anthropic API key first.")
        vm.key = "sk-test-synthetic"
        XCTAssertEqual(vm.statusMessage, "Enter your Anthropic API key.")
    }

    func testPressingSaveBeforeTestExplainsWhy() throws {
        let vm = SetupViewModel(tester: StubTester(result: .valid), store: store, consent: allowed)
        vm.key = "sk-test-synthetic"
        vm.save()
        XCTAssertEqual(vm.statusMessage, "Test the key before saving.")
        XCTAssertNil(try store.get(account: Provider.anthropic.rawValue))
    }

    func testSwitchingProviderShowsThatProvidersOwnState() async throws {
        let vm = SetupViewModel(tester: StubTester(result: .valid), store: store, consent: allowed)
        vm.key = "sk-test-synthetic"
        await vm.testKey()
        vm.save()
        XCTAssertEqual(vm.statusMessage, "Anthropic key saved to Keychain.")
        vm.provider = .openai
        XCTAssertEqual(vm.state, .empty)
        XCTAssertEqual(vm.statusMessage, "Enter your OpenAI API key.")
        vm.provider = .anthropic
        XCTAssertEqual(vm.statusMessage, "Anthropic key saved to Keychain.")
    }

    // App Store Review Guideline 5.1.2(i): "Test key" sends nothing before Allow.
    func testTestKeyAsksForConsentFirstAndSendsNothing() async {
        let tester = CountingTester()
        let vm = SetupViewModel(tester: tester, store: store, consent: consent)
        vm.key = "sk-test-synthetic"
        await vm.testKey()
        XCTAssertEqual(vm.consentRequest, .anthropic)
        XCTAssertEqual(tester.calls, [])
        XCTAssertEqual(vm.state, .empty)
        XCTAssertFalse(vm.sharingAllowed)
    }

    func testNotNowSendsNothingAndStoresNothing() async {
        let tester = CountingTester()
        let vm = SetupViewModel(tester: tester, store: store, consent: consent)
        vm.key = "sk-test-synthetic"
        await vm.testKey()
        vm.declineSharing()
        XCTAssertNil(vm.consentRequest)
        XCTAssertEqual(tester.calls, [])
        XCTAssertFalse(consent.has(.anthropic))
        XCTAssertEqual(vm.statusMessage, "Nothing was sent. Safari Scout tests the key with Anthropic only after you allow sharing.")
    }

    func testAllowStoresConsentThenTests() async {
        let tester = CountingTester()
        let vm = SetupViewModel(tester: tester, store: store, consent: consent)
        vm.key = "sk-test-synthetic"
        await vm.testKey()
        await vm.allowSharing()
        XCTAssertNil(vm.consentRequest)
        XCTAssertEqual(tester.calls, [.anthropic])
        XCTAssertEqual(vm.state, .result(.valid))
        XCTAssertTrue(vm.sharingAllowed)
        XCTAssertTrue(consent.has(.anthropic))
        XCTAssertFalse(consent.has(.openai))
    }

    func testConsentIsPerProvider() async {
        consent.grant(.anthropic)
        let tester = CountingTester()
        let vm = SetupViewModel(tester: tester, store: store, consent: consent)
        vm.provider = .openai
        XCTAssertFalse(vm.sharingAllowed)
        vm.key = "sk-test-synthetic"
        await vm.testKey()
        XCTAssertEqual(vm.consentRequest, .openai)
        XCTAssertEqual(tester.calls, [])
    }

    func testWithdrawBlocksTheNextTest() async {
        let tester = CountingTester()
        let vm = SetupViewModel(tester: tester, store: store, consent: allowed)
        XCTAssertTrue(vm.sharingAllowed)
        vm.withdrawSharing()
        XCTAssertFalse(vm.sharingAllowed)
        XCTAssertFalse(consent.has(.anthropic))
        vm.key = "sk-test-synthetic"
        await vm.testKey()
        XCTAssertEqual(vm.consentRequest, .anthropic)
        XCTAssertEqual(tester.calls, [])
    }

    func testOlderConsentVersionCountsAsNone() {
        UserDefaults(suiteName: consentSuite)!.set(ConsentStore.version - 1, forKey: "aiConsent.anthropic")
        XCTAssertFalse(consent.has(.anthropic))
    }
}
