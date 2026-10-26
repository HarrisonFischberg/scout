import SwiftUI

#if os(macOS)
import AppKit

// The app is only a setup screen: the extension runs inside Safari without it.
// Closing the window quits the app, so it does not linger in the Dock or in
// Command-Tab (the way Wipr and other Safari extensions behave).
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
#endif

@main
struct SafariScoutApp: App {
    #if os(macOS)
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    #endif

    init() {
        #if DEBUG
        // Manual check that the extension can read what the app writes:
        // `-SeedSyntheticKey YES` stores an obviously fake key. DEBUG builds only.
        if UserDefaults.standard.bool(forKey: "SeedSyntheticKey") {
            try? KeychainStore().set("sk-test-synthetic-sharing-check", account: "anthropic")
        }
        #endif
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(Self.forcedScheme)
                // Link-style buttons use the accent-text token, which
                // meets WCAG AA on both canvases.
                .tint(.accentText)
        }
    }
}

extension SafariScoutApp {
    // UI tests pass `-UITestColorScheme dark|light` to audit both appearances.
    // DEBUG builds only; release builds always follow the system setting.
    static var forcedScheme: ColorScheme? {
        #if DEBUG
        switch UserDefaults.standard.string(forKey: "UITestColorScheme") {
        case "dark": return .dark
        case "light": return .light
        default: return nil
        }
        #else
        return nil
        #endif
    }
}

extension Color {
    // Glasshouse look (owner choice 2026-10-26; src/popup.html, html[data-look="glasshouse"]).
    // The token names are from the earlier Trailhead look. Pairs are AA: accent-text on
    // canvas 6.1:1 light / 11.2:1 dark, accent-on on accent-fill 5.7:1 / 8.6:1, muted on
    // surface 10.7:1 / 10.7:1, accent-text on chip 5.6:1 / 7.3:1.
    static let accentText = Color(light: 0x006570, dark: 0x6FD7E2)
    static let accentFill = Color(light: 0x00727F, dark: 0x5FD0DC)
    static let accentOn = Color(light: 0xFFFFFF, dark: 0x04282D)
    static let trailCanvas = Color(light: 0xEEF3F6, dark: 0x0C1316)
    static let trailSurface = Color(light: 0xFFFFFF, dark: 0x162126)
    static let trailChip = Color(light: 0xDBECED, dark: 0x173A40)
    static let trailHairline = Color(light: 0xD5E0E5, dark: 0x24343A)
    static let trailInk = Color(light: 0x0F1A20, dark: 0xEAF3F5)
    static let trailMuted = Color(light: 0x334047, dark: 0xC5D3D7)

    init(light: UInt32, dark: UInt32) {
        func rgb(_ v: UInt32) -> (Double, Double, Double) {
            (Double((v >> 16) & 0xFF) / 255, Double((v >> 8) & 0xFF) / 255, Double(v & 0xFF) / 255)
        }
        let (lr, lg, lb) = rgb(light), (dr, dg, db) = rgb(dark)
        #if os(macOS)
        self.init(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? NSColor(srgbRed: dr, green: dg, blue: db, alpha: 1)
                : NSColor(srgbRed: lr, green: lg, blue: lb, alpha: 1)
        })
        #else
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: dr, green: dg, blue: db, alpha: 1)
                : UIColor(red: lr, green: lg, blue: lb, alpha: 1)
        })
        #endif
    }
}

// Primary action. The system prominent style draws white text on the tint,
// which fails contrast on the dark accent; this pairs fill and text tokens.
struct AccentButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .foregroundStyle(Color.accentOn)
            .background(Color.accentFill.opacity(configuration.isPressed ? 0.85 : 1), in: Capsule())
            .contentShape(Capsule())
    }
}
