import SwiftUI
#if os(macOS)
import AppKit
import SafariServices
#endif

// S01 (macOS) / S02 (iOS): set up in three steps, with progress. Step 1
// (installing) is already done, so people start at "1 of 3 done". Only the
// current step is emphasized and carries the screen's one filled button.
struct OnboardingView: View {
    // The published policy (guideline 5.1.1(i): linked from inside the app).
    static let privacyPolicyURL = URL(string: "https://rarecreatures.app/apps/scout/privacy/")!
    // Scout's own page; on iPhone it opens in Safari, where Scout lives.
    static let scoutPageURL = URL(string: "https://rarecreatures.app/apps/scout/")!

    let progress: SetupProgress
    @Environment(\.openURL) private var openURL

    // Glasshouse look (owner choice 2026-10-26): cool canvas, the Scout truck
    // badge, numbered step cards on solid surfaces. The current step's one
    // action sits in a Liquid Glass bar at the bottom (glass only on controls,
    // never on the content). Text sizes are Dynamic Type styles.
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                SunriseBadge()
                    .frame(width: 64, height: 64)
                    .padding(.bottom, 4)
                    .accessibilityHidden(true)
                Text("Set up Scout AI Assistant")
                    .font(.system(.largeTitle).weight(.heavy))
                    .foregroundStyle(Color.trailInk)
                    .accessibilityAddTraits(.isHeader)
                Text("Your AI Scout for the Safari Browser")
                    .font(.system(.title3))
                    .foregroundStyle(Color.trailMuted)
                StepProgressHeader(done: progress.doneCount, total: progress.total, note: progressNote)
                    .padding(.vertical, 6)
                ForEach(SetupProgress.Step.allCases) { step in
                    StepCard(number: step.rawValue + 1, title: title(step), state: state(step)) {
                        content(step)
                    }
                }
                Link("Privacy policy", destination: Self.privacyPolicyURL)
                    .padding(.top, 4)
            }
            .padding(24)
            .frame(maxWidth: 560, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Color.trailCanvas.ignoresSafeArea())
        .safeAreaInset(edge: .bottom) {
            if let action = primaryAction {
                GlassActionBar(title: action.title, action: action.run)
            }
        }
    }

    /// The current step's one action, shown in the bottom bar.
    private var primaryAction: (title: String, run: () -> Void)? {
        #if os(macOS)
        if progress.current == .enable {
            return ("Open Safari Extension Settings", {
                SFSafariApplication.showPreferencesForExtension(withIdentifier: SetupStatus.extensionBundleIdentifier) { _ in }
            })
        }
        #else
        if progress.current == .key { return ("Open Safari", { openURL(Self.scoutPageURL) }) }
        #endif
        return nil
    }

    private var progressNote: String? {
        #if os(macOS)
        // The Mac app cannot see the key the extension saves, so the last
        // step is finished (and checked) in Safari.
        return progress.current == .key ? "Last step is in Safari" : "About 1 minute left"
        #else
        let m = progress.minutesLeft
        return progress.isComplete ? nil : m == 1 ? "About 1 minute left" : "About \(m) minutes left"
        #endif
    }

    private func state(_ step: SetupProgress.Step) -> StepPhase {
        progress.isDone(step) ? .done : progress.current == step ? .current : .upcoming
    }

    // With Apple Intelligence ready, the key card is an optional extra, not a step.

    private func title(_ step: SetupProgress.Step) -> String {
        switch step {
        case .install: return "Install Scout"
        case .enable: return "Turn on the extension"
        case .key: return progress.isOptional(.key) ? "Optional: add an API key" : "Add your API key"
        }
    }

    private func content(_ step: SetupProgress.Step) -> AnyView {
        let current = progress.current == step
        switch step {
        case .install:
            return AnyView(Text("Installed. Nice start."))
        case .enable:
            #if os(macOS)
            return AnyView(Text(progress.isDone(.enable) ? "Scout is on in Safari." : "Open Safari extension settings, then switch on Scout AI Assistant."))
            #else
            if progress.isDone(.enable) { return AnyView(Text("Scout is on in Safari.")) }
            return AnyView(VStack(alignment: .leading, spacing: 10) {
                Text("Open the Settings app. Go to Apps, then Safari, then Extensions. Switch on Scout AI Assistant and allow it on the websites you choose.")
                if current {
                    Text("This step checks off the first time Scout opens in Safari.")
                        .font(.system(.footnote))
                }
            })
            #endif
        case .key:
            if progress.isDone(.key) { return AnyView(Text("Your key is saved in Keychain.")) }
            if progress.isOptional(.key) {
                return AnyView(Text("Scout already answers with Apple Intelligence on this device, free and with nothing sent anywhere. An Anthropic or OpenAI key adds stronger answers, web search, Scout mode and Find coupons. Add it later in Scout's Settings in Safari."))
            }
            return AnyView(VStack(alignment: .leading, spacing: 10) {
                #if os(macOS)
                Text("Add your key in Safari: click the Scout icon in the toolbar, then Settings.")
                    .bold()
                    .foregroundStyle(Color.trailInk)
                #else
                Text("Add your key in Safari: open Scout from the menu in the address bar, then tap Settings.")
                    .bold()
                    .foregroundStyle(Color.trailInk)
                #endif
                // The key is entered in the extension's own Settings on both
                // platforms: one place to add, test, replace, or delete it.
                // The cost and sharing lines show once this is the step to do
                // (the panel shows them again next to the key field).
                if current {
                    Text("Scout sends page content to the provider you choose, using your own key. The key is stored in Keychain on this device.")
                    Text("Your provider bills your account for every request Scout makes, at the provider's prices. Scout shows an estimated cost after each answer or task.")
                }
            })
        }
    }
}

// One numbered setup step on a rounded card. Done steps show a check and
// recede; the current step gets the accent outline; upcoming steps are muted.
enum StepPhase { case done, current, upcoming }

struct StepCard<Content: View>: View {
    let number: Int
    let title: String
    let state: StepPhase
    @ViewBuilder let content: Content

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            ZStack {
                Circle().fill(state == .upcoming ? Color.trailHairline : state == .done ? Color.trailChip : Color.accentFill)
                if state == .done {
                    Image(systemName: "checkmark").font(.body.weight(.bold)).foregroundStyle(Color.accentText)
                } else {
                    Text("\(number)").font(.system(.body).weight(.heavy))
                        .foregroundStyle(state == .current ? Color.accentOn : Color.trailInk)
                }
            }
            .frame(width: 30, height: 30)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 10) {
                Text(title)
                    .font(.system(state == .current ? .title3 : .headline).weight(.heavy))
                    .foregroundStyle(Color.trailInk)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityLabel("Step \(number), \(title)" + (state == .done ? ", done" : state == .current ? ", current step" : ""))
                content
                    .font(.system(state == .current ? .body : .subheadline))
                    .foregroundStyle(Color.trailMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .background(state == .current ? Color.trailSurface : Color.trailCanvas, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous)
            .strokeBorder(state == .current ? Color.accentFill : Color.trailHairline, lineWidth: state == .current ? 2 : 1))
    }
}

// The Scout badge: the truck (design/icons outline, 64-unit grid) on a teal
// circle (Glasshouse, owner choice 2026-10-26). Decorative.
private struct SunriseBadge: View {
    var body: some View {
        ZStack {
            Circle().fill(Color.accentFill)
            ScoutTruck()
                .stroke(Color.accentOn, style: StrokeStyle(lineWidth: 3.6, lineJoin: .round))
                .background(ScoutTruck().fill(Color.accentFill))
                .padding(16)
        }
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

#Preview {
    OnboardingView(progress: SetupProgress(extensionOn: true, hasKey: false))
}
