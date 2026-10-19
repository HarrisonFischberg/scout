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
        // UI tests pass `-UITestResetConsent YES` so the consent sheet always shows.
        if UserDefaults.standard.bool(forKey: "UITestResetConsent") {
            ConsentStore().withdrawAll()
        }
        #endif
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(Self.forcedScheme)
                // Link-style buttons use the Trailhead accent-text token, which
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
    // Trailhead look (owner choice 2026-10-19; src/popup.html, html[data-look="trailhead"]).
    // Pairs are AA: accent-text on canvas 6.6:1 light / 10.7:1 dark, accent-on on
    // accent-fill 6.4:1 / 9.6:1, muted on surface 8.0:1 / 10.2:1, accent-text on chip 6.0:1 / 7.2:1.
    static let accentText = Color(light: 0x2A6034, dark: 0x9BD6A5)
    static let accentFill = Color(light: 0x2F6B3A, dark: 0x8FD19B)
    static let accentOn = Color(light: 0xFFFFFF, dark: 0x0F1F11)
    static let trailCanvas = Color(light: 0xF6F1E7, dark: 0x131913)
    static let trailSurface = Color(light: 0xFFFDF8, dark: 0x1B231C)
    static let trailChip = Color(light: 0xE2EAD6, dark: 0x2B3A2C)
    static let trailHairline = Color(light: 0xE3D9C5, dark: 0x2B352B)
    static let trailInk = Color(light: 0x1F2A1F, dark: 0xEEF1E8)
    static let trailMuted = Color(light: 0x485245, dark: 0xC9D0C1)
    static let trailSun = Color(light: 0xF2C14E, dark: 0xE9B949)

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
