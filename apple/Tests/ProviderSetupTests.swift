import XCTest

// ProviderSetup.swift and KeychainStore.swift compile into the test target directly.
// Stub tester and test-only Keychain service: no network, no real key.
@MainActor
final class ProviderSetupTests: XCTestCase {
    private struct StubTester: KeyTesting {
        let result: KeyTestResult
        func test(key: String, provider: Provider) async -> KeyTestResult { result }
    }

    private let store = KeychainStore(service: "com.example.AssistAnt.tests.setup")

    override func tearDown() {
        for p in Provider.allCases { try? store.delete(account: p.rawValue) }
        super.tearDown()
    }

    func testValidKeyThenSave() async throws {
        let vm = SetupViewModel(tester: StubTester(result: .valid), store: store)
        vm.key = "sk-test-synthetic-setup"
        await vm.testKey()
        XCTAssertEqual(vm.state, .result(.valid))
        vm.save()
        XCTAssertEqual(vm.state, .saved)
        XCTAssertEqual(vm.key, "")
        XCTAssertEqual(try store.get(account: "anthropic"), "sk-test-synthetic-setup")
    }

    func testInvalidKeyIsNotSaved() async throws {
        let vm = SetupViewModel(tester: StubTester(result: .invalid), store: store)
        vm.key = "sk-test-synthetic-bad"
        await vm.testKey()
        XCTAssertEqual(vm.state, .result(.invalid))
        vm.save()
        XCTAssertNotEqual(vm.state, .saved)
        XCTAssertNil(try store.get(account: "anthropic"))
    }

    func testEditingKeyResetsResult() async {
        let vm = SetupViewModel(tester: StubTester(result: .valid), store: store)
        vm.key = "sk-test-synthetic-a"
        await vm.testKey()
        vm.key = "sk-test-synthetic-b"
        XCTAssertEqual(vm.state, .empty)
    }

    func testEmptyKeyCannotTest() {
        let vm = SetupViewModel(tester: StubTester(result: .valid), store: store)
        XCTAssertFalse(vm.canTest)
    }
}
