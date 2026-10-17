import XCTest

// ManagedPolicy.swift is compiled into the test target directly, so no module import.
final class ManagedPolicyTests: XCTestCase {
    func testAnswersPolicyGetWithTheManagedSites() {
        let reply = ManagedPolicy.handle(["type": "policy.get"], blockedSites: { [" hr.example.com ", "", "payroll.example.com"] })
        XCTAssertEqual(reply?["ok"] as? Bool, true)
        XCTAssertEqual(reply?["blocked"] as? [String], ["hr.example.com", "payroll.example.com"])
    }

    func testIgnoresOtherMessages() {
        XCTAssertNil(ManagedPolicy.handle(["type": "keychain.get", "account": "anthropic"], blockedSites: { ["x.test"] }))
        XCTAssertNil(ManagedPolicy.handle(nil, blockedSites: { ["x.test"] }))
    }

    func testCapsTheList() {
        let many = (0..<500).map { "site\($0).test" }
        let reply = ManagedPolicy.handle(["type": "policy.get"], blockedSites: { many })
        XCTAssertEqual((reply?["blocked"] as? [String])?.count, ManagedPolicy.maxSites)
    }

    func testAnUnmanagedDefaultIsNotAPolicy() {
        // Written by an app, not pushed by a profile: not forced, so not used.
        UserDefaults.standard.set(["x.test"], forKey: ManagedPolicy.blockedSitesKey)
        defer { UserDefaults.standard.removeObject(forKey: ManagedPolicy.blockedSitesKey) }
        XCTAssertEqual(ManagedPolicy.managedBlockedSites(), [])
    }
}
