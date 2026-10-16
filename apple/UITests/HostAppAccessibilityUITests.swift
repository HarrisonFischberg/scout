import XCTest

// T006: the host app's setup screen passes Apple's automated accessibility
// audit in light and dark appearance, and the legal draft sheet can be closed.
final class HostAppAccessibilityUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = true
    }

    private enum Scheme: String { case light, dark }

    private func launch(_ scheme: Scheme) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-UITestColorScheme", scheme.rawValue, "-UITestResetConsent", "YES"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Set up Safari Scout"].waitForExistence(timeout: 10))
        // Prove the scheme took effect: sample the top-left background pixel.
        let png = app.screenshot().image
        let dark = Self.isDarkCorner(png)
        XCTAssertEqual(dark, scheme == .dark, "app rendered in the wrong color scheme")
        return app
    }

    private static func isDarkCorner(_ image: UIImage) -> Bool {
        guard let cg = image.cgImage,
              let crop = cg.cropping(to: CGRect(x: 20, y: cg.height / 2, width: 1, height: 1)) else { return false }
        var px = [UInt8](repeating: 0, count: 4)
        let ctx = CGContext(data: &px, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                            space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        ctx?.draw(crop, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        return (Int(px[0]) + Int(px[1]) + Int(px[2])) / 3 < 128
    }

    // Collects every audit issue, then fails once with the full list, so one
    // run shows all problems. Nothing is filtered or ignored.
    private func audit(_ app: XCUIApplication, _ screen: String) throws {
        var issues: [String] = []
        try app.performAccessibilityAudit { issue in
            let el = issue.element.map { "\($0.elementType.rawValue) '\($0.label)'" } ?? "no element"
            issues.append("\(screen): \(issue.compactDescription) — \(el)")
            return true
        }
        XCTAssertEqual(issues, [], issues.joined(separator: "\n"))
    }

    private func attachScreenshot(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    func testSetupScreenAuditLight() throws {
        let app = launch(.light)
        attachScreenshot("T006-ios-setup-light")
        try audit(app, "setup-light")
    }

    func testSetupScreenAuditDark() throws {
        let app = launch(.dark)
        attachScreenshot("T006-ios-setup-dark")
        try audit(app, "setup-dark")
    }

    // App Store Review Guideline 5.1.2(i): "Test key" first shows the consent
    // sheet. Only "Not now" is tapped, so nothing is sent (no network here).
    private func consentSheet(_ scheme: Scheme) throws {
        let app = launch(scheme)
        let field = app.secureTextFields["API key"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("sk-ant-test-synthetic-ui-0000")
        app.buttons["Test key"].tap()
        XCTAssertTrue(app.staticTexts["Share with Anthropic?"].waitForExistence(timeout: 5))
        // SwiftUI may expose Link as a link or a button.
        XCTAssertTrue(app.links["Anthropic privacy policy"].exists || app.buttons["Anthropic privacy policy"].exists)
        attachScreenshot("consent-sheet-\(scheme.rawValue)")
        try audit(app, "consent-\(scheme.rawValue)")
        app.buttons["Not now"].tap()
        XCTAssertTrue(app.staticTexts["Set up Safari Scout"].waitForExistence(timeout: 5))
        let status = app.staticTexts["Key status: Nothing was sent. Safari Scout tests the key with Anthropic only after you allow sharing."]
        XCTAssertTrue(status.waitForExistence(timeout: 5))
    }

    func testConsentSheetAuditLight() throws { try consentSheet(.light) }
    func testConsentSheetAuditDark() throws { try consentSheet(.dark) }

    func testLegalSheetOpensAndCloses() throws {
        let app = launch(.light)
        let privacy = app.buttons["Privacy policy (draft)"]
        if !privacy.isHittable { app.swipeUp() }
        privacy.tap()
        XCTAssertTrue(app.staticTexts["DRAFT. Not approved by legal review."].waitForExistence(timeout: 5))
        attachScreenshot("T006-ios-legal-sheet")
        try audit(app, "legal-sheet")
        app.buttons["Done"].tap()
        XCTAssertTrue(app.staticTexts["Set up Safari Scout"].waitForExistence(timeout: 5))
    }
}
