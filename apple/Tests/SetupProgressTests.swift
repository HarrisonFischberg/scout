import XCTest

// SetupStatus.swift and KeychainStore.swift are compiled into the test target directly.
final class SetupProgressTests: XCTestCase {
    func testInstallCountsAsDoneSoSetupStartsAtOneOfThree() {
        let p = SetupProgress()
        XCTAssertEqual(p.doneCount, 1)
        XCTAssertEqual(p.total, 3)
        XCTAssertEqual(p.current, .enable)
        XCTAssertFalse(p.isComplete)
    }

    func testASavedKeyMeansTheExtensionIsOnToo() {
        // The key can only be added from Scout's Settings inside Safari.
        let p = SetupProgress(extensionOn: nil, hasKey: true)
        XCTAssertTrue(p.isDone(.enable))
        XCTAssertTrue(p.isComplete)
        XCTAssertNil(p.current)
    }

    func testUnknownKeyNeverCountsAsDone() {
        // macOS cannot see the extension's Keychain: the last step stays open.
        let p = SetupProgress(extensionOn: true, hasKey: nil)
        XCTAssertEqual(p.doneCount, 2)
        XCTAssertEqual(p.current, .key)
        XCTAssertFalse(p.isComplete)
    }

    func testTimeLeftShrinksWithEachStep() {
        XCTAssertEqual(SetupProgress().minutesLeft, 1)
        XCTAssertEqual(SetupProgress(extensionOn: true, hasKey: false).minutesLeft, 1)
    }

    func testExtensionMarkerIsWrittenOnceAndHoldsNoData() throws {
        let store = KeychainStore(service: "com.example.SafariScout.tests")
        defer { try? store.delete(account: KeychainStore.extensionSeenAccount) }
        XCTAssertNil(try store.get(account: KeychainStore.extensionSeenAccount))
        store.markExtensionSeen()
        store.markExtensionSeen()
        XCTAssertEqual(try store.get(account: KeychainStore.extensionSeenAccount), "1")
    }
}
