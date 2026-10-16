import XCTest

// KeychainStore.swift is compiled into the test target directly, so no module import.
// A test-only service name keeps real provider keys untouched.
final class KeychainStoreTests: XCTestCase {
    private let store = KeychainStore(service: "com.example.SafariScout.tests")
    private let account = "anthropic"

    override func tearDown() {
        try? store.delete(account: account)
        super.tearDown()
    }

    func testSetGetDelete() throws {
        XCTAssertNil(try store.get(account: account))
        try store.set("sk-test-synthetic-1", account: account)
        XCTAssertEqual(try store.get(account: account), "sk-test-synthetic-1")
        try store.set("sk-test-synthetic-2", account: account)
        XCTAssertEqual(try store.get(account: account), "sk-test-synthetic-2")
        try store.delete(account: account)
        XCTAssertNil(try store.get(account: account))
    }

    func testDeleteMissingIsOk() throws {
        XCTAssertNoThrow(try store.delete(account: account))
    }

    func testBridgeRoundTrip() {
        let set = KeychainBridge.handle(
            ["type": "keychain.set", "account": account, "value": "sk-test-synthetic-3"], store: store)
        XCTAssertEqual(set["ok"] as? Bool, true)
        let got = KeychainBridge.handle(["type": "keychain.get", "account": account], store: store)
        XCTAssertEqual(got["value"] as? String, "sk-test-synthetic-3")
        let del = KeychainBridge.handle(["type": "keychain.delete", "account": account], store: store)
        XCTAssertEqual(del["ok"] as? Bool, true)
        let gone = KeychainBridge.handle(["type": "keychain.get", "account": account], store: store)
        XCTAssertNil(gone["value"])
    }

    func testBridgeRejectsBadRequests() {
        XCTAssertEqual(KeychainBridge.handle(nil)["error"] as? String, "bad_request")
        XCTAssertEqual(
            KeychainBridge.handle(["type": "keychain.set", "account": account])["error"] as? String,
            "bad_request")
        XCTAssertEqual(
            KeychainBridge.handle(["type": "nope", "account": account])["error"] as? String,
            "unknown_type")
    }
}
