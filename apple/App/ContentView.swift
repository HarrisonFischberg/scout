import SwiftUI
#if os(macOS)
import AppKit
#endif

// The app's navigation shell. Scout lives in Safari, so the app has one job
// (get Scout ready) and no tab bar: setup until every step is done, one
// short check and a success screen the first time, then a "ready" home.
// If the key is removed later, setup comes back on its own.
// iPhone (owner request 2026-11-01): once there is a key or Apple's model, or
// the person chose to chat in the app, the app opens straight into Scout's
// own chat (ChatView.swift) and setup moves behind its Settings.
struct ContentView: View {
    @State private var status = SetupStatus()
    @AppStorage("setup.celebrated") private var celebrated = false
    @State private var screen: Screen = .setup
    @Environment(\.scenePhase) private var scenePhase
    #if os(iOS)
    @AppStorage("chat.chosen") private var chatChosen = false
    @State private var loaded = false
    @State private var showSetup = false
    #endif

    enum Screen { case setup, checking, success, ready }

    var body: some View {
        #if os(iOS)
        Group {
            if !loaded {
                Color.trailCanvas.ignoresSafeArea()
            } else if showsChat {
                ChatScreen(onSetup: { showSetup = true })
                    .sheet(isPresented: $showSetup, onDismiss: { Task { await status.refresh() } }) { setupSheet }
            } else {
                setupFlow
            }
        }
        .task {
            await status.refresh()
            loaded = true
        }
        #else
        setupFlow
        #endif
    }

    #if os(iOS)
    /// Chat is the home screen when it can answer (a key or Apple's model), or when the person chose it.
    private var showsChat: Bool {
        chatChosen || status.progress.hasKey == true || status.progress.appleReady
    }

    /// Safari setup, opened from the chat's Settings.
    private var setupSheet: some View {
        NavigationStack {
            Group {
                if status.progress.isComplete {
                    ReadyView()
                } else {
                    OnboardingView(progress: status.progress)
                }
            }
            .background(Color.trailCanvas.ignoresSafeArea())
            .navigationTitle("Scout in Safari")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { showSetup = false }
                }
            }
        }
        .task { await status.refresh() }
    }
    #endif

    private var setupFlow: some View {
        NavigationStack {
            Group {
                switch screen {
                case .setup:
                    #if os(iOS)
                    OnboardingView(progress: status.progress, onChat: { chatChosen = true })
                    #else
                    OnboardingView(progress: status.progress)
                    #endif
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
                            message: status.progress.isOptional(.key) && status.progress.hasKey != true
                                ? "Scout is on in Safari and answers with Apple Intelligence on this device. No key needed."
                                : "Scout is on in Safari and your key is saved in Keychain.",
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

    // The two real checks behind "Scout is ready". Each re-reads the device.
    private var checks: [StagedProgressView.Stage] {
        let safari = StagedProgressView.Stage(running: "Checking Scout in Safari…", done: "Scout is on in Safari",
                                              failed: "Scout hasn't opened in Safari yet") {
            await status.refresh()
            return status.progress.isDone(.enable)
        }
        // With Apple Intelligence the key is optional, so check the model instead.
        let apple = StagedProgressView.Stage(running: "Checking Apple Intelligence…", done: "Apple Intelligence is ready",
                                             failed: "Apple Intelligence isn't ready on this device") {
            await status.refresh()
            return status.progress.appleReady
        }
        let key = StagedProgressView.Stage(running: "Checking your key in Keychain…", done: "Your key is saved",
                                           failed: "No key found. Add it in Scout's Settings in Safari.") {
            await status.refresh()
            return status.progress.isDone(.key)
        }
        return [safari, status.progress.isOptional(.key) ? apple : key]
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
                        .font(.system(.largeTitle).weight(.heavy))
                        .foregroundStyle(Color.trailInk)
                } icon: {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.accentText)
                }
                .accessibilityAddTraits(.isHeader)
                Text("Open Scout from the menu in Safari's address bar on any page.")
                    .font(.system(.title3))
                    .foregroundStyle(Color.trailMuted)
                Button("Open Safari") { openURL(OnboardingView.scoutPageURL) }
                    .buttonStyle(AccentButtonStyle())
                VStack(alignment: .leading, spacing: 14) {
                    Text("Things to try")
                        .font(.system(.headline))
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
                Text(title).font(.system(.body).weight(.semibold)).foregroundStyle(Color.trailInk)
                Text(detail).font(.system(.subheadline)).foregroundStyle(Color.trailMuted)
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
                Text("To replace or remove your key, open Settings in the Scout app's chat, or Scout's Settings in Safari.")
                Link("Privacy policy", destination: OnboardingView.privacyPolicyURL)
            }
            .font(.system(.body))
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
