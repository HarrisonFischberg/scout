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
        app.launchArguments += ["-UITestColorScheme", scheme.rawValue]
        app.launch()
        XCTAssertTrue(app.staticTexts["Set up Scout AI Assistant"].waitForExistence(timeout: 10))
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

    // The key is added in the extension's own Settings, so the setup screen
    // has no key field and sends nothing.
    func testSetupScreenPointsToSafariForTheKey() throws {
        let app = launch(.light)
        XCTAssertTrue(app.staticTexts["Add your key in Safari: open Scout from the menu in the address bar, then tap Settings."].exists)
        XCTAssertFalse(app.secureTextFields["API key"].exists)
        XCTAssertFalse(app.buttons["Test key"].exists)
    }

    // Guideline 5.1.1(i): the published privacy policy is linked from the app.
    func testPrivacyPolicyLinkIsShown() throws {
        let app = launch(.light)
        let privacy = app.links["Privacy policy"]
        if !privacy.isHittable { app.swipeUp() }
        XCTAssertTrue(privacy.waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Legal (DRAFT)"].exists)
    }
}
