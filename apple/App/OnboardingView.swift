import SwiftUI
#if os(macOS)
import AppKit
import SafariServices
#endif

// S01 (macOS) / S02 (iOS): enable the extension. S03: where to add the key.
struct OnboardingView: View {
    // Must match PRODUCT_BUNDLE_IDENTIFIER of the macOS extension target (only macOS uses it).
    private let extensionBundleIdentifier = "com.harrisonfischberg.SafariScout.Extension"
    // The published policy (guideline 5.1.1(i): linked from inside the app).
    static let privacyPolicyURL = URL(string: "https://rarecreatures.app/apps/scout/privacy/")!

    #if os(macOS)
    // Live status for step 1 (nil until Safari answers).
    @State private var extensionOn: Bool?
    #endif

    // Trailhead look (owner choice 2026-10-19): sand canvas, a sunrise badge
    // with the Scout truck, numbered step cards, rounded type. Text sizes are
    // Dynamic Type styles, so the system text size setting still applies.
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // 64 pt, not 84: with the privacy link as a one-line footer the
                // whole screen fits on an iPhone 17 Pro at the default text size,
                // so no text sits half cut off at the bottom edge (the light
                // accessibility audit failed on a clipped "Legal" heading).
                SunriseBadge()
                    .frame(width: 64, height: 64)
                    .padding(.bottom, 4)
                    .accessibilityHidden(true)
                Text("Set up Scout AI Assistant")
                    .font(.system(.largeTitle, design: .rounded).weight(.heavy))
                    .foregroundStyle(Color.trailInk)
                    .accessibilityAddTraits(.isHeader)
                Text("Your AI Scout for the Safari Browser")
                    .font(.system(.title3, design: .rounded))
                    .foregroundStyle(Color.trailMuted)
                    .padding(.bottom, 6)
                enableSection
                keySection
                legalSection
            }
            .padding(24)
            .frame(maxWidth: 560, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Color.trailCanvas.ignoresSafeArea())
        #if os(macOS)
        .task { refreshExtensionState() }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            refreshExtensionState()
        }
        #endif
    }

    #if os(macOS)
    private func refreshExtensionState() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { state, _ in
            DispatchQueue.main.async { extensionOn = state?.isEnabled }
        }
    }
    #endif

    private var enableSection: some View {
        #if os(macOS)
        StepCard(number: 1, done: extensionOn == true, title: "1. Turn on the extension", status: extensionOn.map { $0 ? "On" : "Off" }) {
            Text("Open Safari extension settings, then switch on Scout AI Assistant.")
            Button("Open Safari Extension Settings") {
                SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { _ in }
            }
            .buttonStyle(AccentButtonStyle())
        }
        #else
        StepCard(number: 1, done: false, title: "1. Turn on the extension", status: nil) {
            Text("Open the Settings app. Go to Apps, then Safari, then Extensions. Switch on Scout AI Assistant and allow it on the websites you choose.")
        }
        #endif
    }

    // The key is entered in the extension's own Settings on both platforms:
    // one place to add, test, replace, or delete it, and the extension asks
    // for permission to share with the provider before the first request.
    // (On iOS the app and the extension share one Keychain item, so a key
    // saved in either is the same key.)
    private var keySection: some View {
        StepCard(number: 2, done: false, title: "2. Add your API key", status: nil) {
            Text("Scout sends page content to the provider you choose, using your own key. The key is stored in Keychain on this device.")
            Text("Your provider bills your account for every request Scout makes, at the provider's prices. Scout shows an estimated cost after each answer or task.")
            #if os(macOS)
            Text("Add your key in Safari: click the Scout icon in the toolbar, then Settings.")
                .bold()
                .foregroundStyle(Color.trailInk)
            #else
            Text("Add your key in Safari: open Scout from the menu in the address bar, then tap Settings.")
                .bold()
                .foregroundStyle(Color.trailInk)
            #endif
        }
    }
}

// One numbered setup step on a rounded card. A done step shows a check
// instead of its number; `status` is a short live state ("On", "Off").
private struct StepCard<Content: View>: View {
    let number: Int
    let done: Bool
    let title: String
    let status: String?
    @ViewBuilder let content: Content

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            ZStack {
                Circle().fill(done ? Color.accentFill : Color.trailChip)
                if done {
                    Image(systemName: "checkmark").font(.body.weight(.bold)).foregroundStyle(Color.accentOn)
                } else {
                    Text("\(number)").font(.system(.body, design: .rounded).weight(.heavy)).foregroundStyle(Color.accentText)
                }
            }
            .frame(width: 30, height: 30)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(title)
                        .font(.system(.title3, design: .rounded).weight(.heavy))
                        .foregroundStyle(Color.trailInk)
                        .accessibilityAddTraits(.isHeader)
                    if let status {
                        Text(status)
                            .font(.system(.caption, design: .rounded).weight(.heavy))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(Color.trailChip, in: Capsule())
                            .foregroundStyle(Color.accentText)
                    }
                }
                content
                    .font(.system(.body, design: .rounded))
                    .foregroundStyle(Color.trailMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .background(Color.trailSurface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.trailHairline))
    }
}

// The sunrise badge: the Scout truck (design/icons outline, 64-unit grid)
// on forest green with a low sun. Decorative.
private struct SunriseBadge: View {
    var body: some View {
        ZStack {
            Circle().fill(Color.accentFill)
            Circle()
                .fill(Color.trailSun)
                .scaleEffect(0.76)
                .offset(y: 46)
                .clipShape(Circle())
            ScoutTruck()
                .stroke(Color.accentOn, style: StrokeStyle(lineWidth: 3.6, lineJoin: .round))
                .background(ScoutTruck().fill(Color.accentFill))
                .padding(16)
        }
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(Color.trailHairline).padding(-7))
    }
}

private struct ScoutTruck: Shape {
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 64
        let o = CGPoint(x: rect.midX - 32 * s, y: rect.midY - 32 * s)
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: o.x + x * s, y: o.y + y * s) }
        var path = Path()
        path.addLines([p(13, 26), p(16.5, 11), p(36, 11), p(40.5, 26)]); path.closeSubpath()
        path.addLines([p(21, 16), p(32.5, 16), p(34.5, 23), p(21, 23)]); path.closeSubpath()
        path.addRoundedRect(in: CGRect(origin: p(5, 26), size: CGSize(width: 54 * s, height: 17 * s)), cornerSize: CGSize(width: 4 * s, height: 4 * s))
        for cx in [18.0, 46.0] {
            path.addEllipse(in: CGRect(origin: p(cx - 9, 35), size: CGSize(width: 18 * s, height: 18 * s)))
            path.addEllipse(in: CGRect(origin: p(cx - 2.5, 41.5), size: CGSize(width: 5 * s, height: 5 * s)))
        }
        return path
    }
}

extension OnboardingView {
    fileprivate var legalSection: some View {
        Link("Privacy policy", destination: Self.privacyPolicyURL)
    }
}

#Preview {
    OnboardingView()
}
