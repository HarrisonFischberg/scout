import SwiftUI
#if os(macOS)
import AppKit
#endif

// The app's navigation shell. Scout lives in Safari, so the app has one job
// (get Scout ready) and no tab bar: setup until every step is done, one
// short check and a success screen the first time, then a "ready" home.
// If the key is removed later, setup comes back on its own.
struct ContentView: View {
    @State private var status = SetupStatus()
    @AppStorage("setup.celebrated") private var celebrated = false
    @State private var screen: Screen = .setup
    @Environment(\.scenePhase) private var scenePhase

    enum Screen { case setup, checking, success, ready }

    var body: some View {
        NavigationStack {
            Group {
                switch screen {
                case .setup:
                    OnboardingView(progress: status.progress)
                case .checking:
                    centered {
                        StagedProgressView(title: "Checking your setup", stages: checks) { outcome in
                            screen = outcome == .passed ? .success : .setup
                        }
                    }
                case .success:
                    centered {
                        SuccessView(
                            title: "Scout is ready",
                            message: "Scout is on in Safari and your key is saved in Keychain.",
                            nextStepTitle: "Try it now",
                            nextStepDetail: "Open any page in Safari, tap the menu in the address bar, choose Scout, then tap Summarize this page.",
                            primaryLabel: "Open Safari",
                            primaryAction: { celebrated = true; screen = .ready; openURL(OnboardingView.scoutPageURL) },
                            secondaryLabel: "Done",
                            secondaryAction: { celebrated = true; screen = .ready }
                        )
                    }
                case .ready:
                    ReadyView()
                }
            }
            .background(Color.trailCanvas.ignoresSafeArea())
            #if os(iOS)
            .toolbar(.hidden, for: .navigationBar)
            #endif
        }
        .task { await refresh() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await refresh() } }
        }
        #if os(macOS)
        // Coming back from Safari's settings window does not change scenePhase on macOS.
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            Task { await refresh() }
        }
        #endif
    }

    @Environment(\.openURL) private var openURL

    private func refresh() async {
        // Leave the check and success screens alone while they are showing.
        guard screen == .setup || screen == .ready else { return }
        await status.refresh()
        if !status.progress.isComplete {
            screen = .setup
        } else if celebrated {
            screen = .ready
        } else {
            screen = .checking
        }
    }

    // The two real checks behind "Scout is ready". Each re-reads the Keychain.
    private var checks: [StagedProgressView.Stage] {
        [
            .init(running: "Checking Scout in Safari…", done: "Scout is on in Safari",
                  failed: "Scout hasn't opened in Safari yet") {
                await status.refresh()
                return status.progress.isDone(.enable)
            },
            .init(running: "Checking your key in Keychain…", done: "Your key is saved",
                  failed: "No key found. Add it in Scout's Settings in Safari.") {
                await status.refresh()
                return status.progress.isDone(.key)
            },
        ]
    }

    private func centered<V: View>(@ViewBuilder _ content: () -> V) -> some View {
        ScrollView {
            content()
                .padding(24)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity, minHeight: 520)
        }
    }
}

// Home once setup is done. The one standout is "Open Safari"; the tips and
// the privacy page are quiet and one tap away.
struct ReadyView: View {
    @Environment(\.openURL) private var openURL

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Label {
                    Text("Scout is ready")
                        .font(.system(.largeTitle, design: .rounded).weight(.heavy))
                        .foregroundStyle(Color.trailInk)
                } icon: {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.accentText)
                }
                .accessibilityAddTraits(.isHeader)
                Text("Open Scout from the menu in Safari's address bar on any page.")
                    .font(.system(.title3, design: .rounded))
                    .foregroundStyle(Color.trailMuted)
                Button("Open Safari") { openURL(OnboardingView.scoutPageURL) }
                    .buttonStyle(AccentButtonStyle())
                VStack(alignment: .leading, spacing: 14) {
                    Text("Things to try")
                        .font(.system(.headline, design: .rounded))
                        .foregroundStyle(Color.trailInk)
                        .accessibilityAddTraits(.isHeader)
                    tip("doc.text.magnifyingglass", "Summarize this page", "One tap on any article or product.")
                    tip("text.bubble", "Ask anything", "About the page, or anything on the web.")
                    tip("tag", "Find coupons", "On a checkout page, Scout tries codes and keeps the best one.")
                    tip("car", "Scout mode", "Tell Scout what to do; it asks before anything sensitive.")
                }
                .padding(16)
                .background(Color.trailSurface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.trailHairline))
                NavigationLink("Privacy and costs") { PrivacyCostsView() }
            }
            .padding(24)
            .frame(maxWidth: 560, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
    }

    private func tip(_ symbol: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.body.weight(.semibold))
                .foregroundStyle(Color.accentText)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(.body, design: .rounded).weight(.semibold)).foregroundStyle(Color.trailInk)
                Text(detail).font(.system(.subheadline, design: .rounded)).foregroundStyle(Color.trailMuted)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

struct PrivacyCostsView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Scout sends page content to the provider you choose, using your own key. The key is stored in Keychain on this device.")
                Text("Your provider bills your account for every request Scout makes, at the provider's prices. Scout shows an estimated cost after each answer or task.")
                Text("To replace or remove your key, open Scout in Safari, then Settings.")
                Link("Privacy policy", destination: OnboardingView.privacyPolicyURL)
            }
            .font(.system(.body, design: .rounded))
            .foregroundStyle(Color.trailMuted)
            .padding(24)
            .frame(maxWidth: 560, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Color.trailCanvas.ignoresSafeArea())
        .navigationTitle("Privacy and costs")
        #if os(iOS)
        .toolbar(.visible, for: .navigationBar)
        #endif
    }
}

#Preview {
    ContentView()
}
