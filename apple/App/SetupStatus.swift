import Foundation
import Observation
#if os(macOS)
import SafariServices
#endif
#if canImport(FoundationModels)
import FoundationModels
#endif

// The three setup steps and where each one stands. Every check is a real
// signal; nothing is marked done on a timer.
//   install: always done (the app is open).
//   enable:  macOS asks Safari; iOS sees the extension's marker in the shared
//            Keychain (written the first time Scout opens in Safari) or a key.
//   key:     iOS reads the shared Keychain item. macOS cannot see the
//            extension's Keychain, so the step stays "finish in Safari".
//            Optional when Apple Intelligence is ready (owner's choice
//            2026-10-25: Scout answers with Apple's on-device model, no key).
struct SetupProgress: Equatable {
    enum Step: Int, CaseIterable, Identifiable {
        case install, enable, key
        var id: Int { rawValue }
    }

    var extensionOn: Bool?
    var hasKey: Bool?
    /// Apple's on-device model can answer here, so a key is an optional upgrade.
    var appleReady = false

    /// The steps that count toward "done": the key only when Apple's model can't answer.
    var steps: [Step] { appleReady ? [.install, .enable] : Step.allCases }
    func isOptional(_ step: Step) -> Bool { !steps.contains(step) }

    func isDone(_ step: Step) -> Bool {
        switch step {
        case .install: return true
        case .enable: return extensionOn == true || hasKey == true
        case .key: return hasKey == true
        }
    }

    var doneCount: Int { steps.filter(isDone).count }
    var total: Int { steps.count }
    var isComplete: Bool { doneCount == total }
    /// The first step not done yet: the one step that gets the screen's emphasis.
    var current: Step? { steps.first { !isDone($0) } }
    /// Honest estimate from what is left: about half a minute per step.
    var minutesLeft: Int { max(1, Int((Double(total - doneCount) * 0.5).rounded(.up))) }
}

@MainActor @Observable
final class SetupStatus {
    // Must match PRODUCT_BUNDLE_IDENTIFIER of the macOS extension target (only macOS uses it).
    static let extensionBundleIdentifier = "com.harrisonfischberg.Scoutai.Extension"
    static let providerAccounts = ["anthropic", "openai"]

    private(set) var progress = SetupProgress()
    private let store: KeychainStore

    init(store: KeychainStore = KeychainStore()) {
        self.store = store
    }

    func refresh() async {
        #if os(macOS)
        let on: Bool? = await withCheckedContinuation { done in
            SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: Self.extensionBundleIdentifier) { state, _ in
                done.resume(returning: state?.isEnabled)
            }
        }
        progress = SetupProgress(extensionOn: on, hasKey: nil, appleReady: Self.appleModelReady)
        #else
        let hasKey = Self.providerAccounts.contains { (try? store.get(account: $0)) != nil }
        let seen = (try? store.get(account: KeychainStore.extensionSeenAccount)) != nil
        progress = SetupProgress(extensionOn: seen, hasKey: hasKey, appleReady: Self.appleModelReady)
        #endif
    }

    /// True when Apple Intelligence's on-device model can answer on this device.
    static var appleModelReady: Bool {
        #if DEBUG
        // UI tests pin the three-step flow, whatever the Simulator's Mac supports.
        if UserDefaults.standard.bool(forKey: "UITestNoAppleModel") { return false }
        #endif
        #if canImport(FoundationModels)
        if #available(iOS 26.0, macOS 26.0, *) {
            if case .available = SystemLanguageModel.default.availability { return true }
        }
        #endif
        return false
    }
}
