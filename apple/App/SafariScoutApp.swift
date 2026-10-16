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
                // Link-style buttons use the design's accent-text token, which
                // meets WCAG AA on both canvases; system blue measured ~4:1.
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
    // replica/design/tokens.json: color.{light,dark}.accent-text (Apple blue)
    static let accentText = Color(light: 0x0066CC, dark: 0x2997FF)
    // color.{light,dark}.accent / accent-on: 4.70:1 light, 4.57:1 dark.
    static let accentFill = Color(light: 0x0071E3, dark: 0x0073E6)
    static let accentOn = Color(light: 0xFFFFFF, dark: 0xFFFFFF)

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
