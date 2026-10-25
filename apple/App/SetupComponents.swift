import SwiftUI
#if os(macOS)
import AppKit
#endif

// Reusable pieces for the setup flow (UX redesign, 2026-10-25): a progress
// header, a staged progress view for the one trust moment, and a success
// screen. All text is Dynamic Type; motion drops to fades with Reduce Motion.

// MARK: - Progress header (goal gradient)

/// "2 of 3 done", a bar, and what is left. Step 1 (installing) counts as done.
struct StepProgressHeader: View {
    let done: Int
    let total: Int
    /// Short trailing note, e.g. "About 1 minute left".
    let note: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(done) of \(total) done")
                    .font(.system(.subheadline, design: .rounded).weight(.heavy))
                    .foregroundStyle(Color.accentText)
                Spacer()
                if let note {
                    Text(note)
                        .font(.system(.subheadline, design: .rounded))
                        .foregroundStyle(Color.trailMuted)
                }
            }
            ProgressView(value: Double(done), total: Double(total))
                .tint(Color.accentFill)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Setup progress")
        .accessibilityValue("\(done) of \(total) steps done" + (note.map { ". " + $0 } ?? ""))
    }
}

// MARK: - Staged progress (labor illusion, honest)

/// Runs real checks one after another and shows each as it happens:
/// spinner while running, check when it passes, a plain message when it
/// fails. Each stage stays on screen at least `minimumStageTime` so the words
/// can be read; that floor is the only added wait (3 stages ≈ 1 s).
struct StagedProgressView: View {
    struct Stage: Identifiable {
        let id = UUID()
        let running: String
        let done: String
        let failed: String
        let work: @MainActor () async -> Bool
    }

    enum Outcome: Equatable { case passed, failed(index: Int) }

    let title: String
    let stages: [Stage]
    var minimumStageTime: Duration = .milliseconds(350)
    let onFinish: (Outcome) -> Void

    @State private var reached = 0
    @State private var failedAt: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title)
                .font(.system(.title3, design: .rounded).weight(.heavy))
                .foregroundStyle(Color.trailInk)
                .accessibilityAddTraits(.isHeader)
            ForEach(Array(stages.enumerated()), id: \.element.id) { index, stage in
                row(index: index, stage: stage)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.trailSurface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.trailHairline))
        .task { await run() }
    }

    @ViewBuilder
    private func row(index: Int, stage: Stage) -> some View {
        let state: RowState = failedAt == index ? .failed : index < reached ? .done : index == reached ? .running : .waiting
        HStack(spacing: 12) {
            Group {
                switch state {
                case .running: ProgressView().controlSize(.small)
                case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.accentText)
                case .failed: Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Color.trailInk)
                case .waiting: Image(systemName: "circle").foregroundStyle(Color.trailHairline)
                }
            }
            .font(.body.weight(.semibold))
            .frame(width: 24)
            .accessibilityHidden(true)
            Text(state == .done ? stage.done : state == .failed ? stage.failed : stage.running)
                .font(.system(.body, design: .rounded))
                .foregroundStyle(state == .waiting ? Color.trailMuted : Color.trailInk)
        }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: state)
        .accessibilityElement(children: .combine)
    }

    private enum RowState { case waiting, running, done, failed }

    private func run() async {
        for (index, stage) in stages.enumerated() {
            reached = index
            let clock = ContinuousClock()
            let start = clock.now
            let ok = await stage.work()
            let elapsed = clock.now - start
            if elapsed < minimumStageTime { try? await Task.sleep(for: minimumStageTime - elapsed) }
            guard ok else {
                failedAt = index
                announce(stage.failed)
                onFinish(.failed(index: index))
                return
            }
        }
        reached = stages.count
        onFinish(.passed)
    }
}

// MARK: - Success screen (peak-end)

/// The finish of a flow: a big check, one line of what happened, one next
/// step as the only filled button, and a .success haptic.
struct SuccessView: View {
    let title: String
    let message: String
    let nextStepTitle: String
    let nextStepDetail: String
    let primaryLabel: String
    let primaryAction: () -> Void
    var secondaryLabel: String?
    var secondaryAction: (() -> Void)?

    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 72, weight: .semibold))
                .foregroundStyle(Color.accentFill)
                .scaleEffect(shown || reduceMotion ? 1 : 0.6)
                .opacity(shown ? 1 : 0)
                .symbolEffect(.bounce, value: reduceMotion ? false : shown)
                .accessibilityHidden(true)
            VStack(spacing: 8) {
                Text(title)
                    .font(.system(.largeTitle, design: .rounded).weight(.heavy))
                    .foregroundStyle(Color.trailInk)
                    .accessibilityAddTraits(.isHeader)
                Text(message)
                    .font(.system(.body, design: .rounded))
                    .foregroundStyle(Color.trailMuted)
            }
            .multilineTextAlignment(.center)
            VStack(alignment: .leading, spacing: 6) {
                Text(nextStepTitle)
                    .font(.system(.headline, design: .rounded))
                    .foregroundStyle(Color.trailInk)
                Text(nextStepDetail)
                    .font(.system(.body, design: .rounded))
                    .foregroundStyle(Color.trailMuted)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.trailSurface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.trailHairline))
            .accessibilityElement(children: .combine)
            Button(primaryLabel, action: primaryAction)
                .buttonStyle(AccentButtonStyle())
            if let secondaryLabel, let secondaryAction {
                Button(secondaryLabel, action: secondaryAction)
                    .font(.system(.body, design: .rounded))
            }
        }
        .padding(24)
        .frame(maxWidth: 560)
        .onAppear {
            withAnimation(reduceMotion ? .easeIn(duration: 0.2) : .spring(response: 0.45, dampingFraction: 0.6)) {
                shown = true
            }
            announce(title + ". " + message)
        }
        .sensoryFeedback(.success, trigger: shown) { _, now in now }
    }
}

// MARK: - Helpers

/// Speaks a status change to VoiceOver (no-op when it is off).
@MainActor
func announce(_ text: String) {
    #if os(iOS)
    UIAccessibility.post(notification: .announcement, argument: text)
    #else
    NSAccessibility.post(element: NSApplication.shared, notification: .announcementRequested,
                         userInfo: [.announcement: text, .priority: NSAccessibilityPriorityLevel.high.rawValue])
    #endif
}
