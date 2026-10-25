import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

// Apple's on-device model (Apple Intelligence, iOS 26 / macOS 26) for people
// without an API key (owner's choice 2026-10-25). Runs on the device: no key,
// no bill, nothing sent off the device.
// Request:  {"type": "ai.apple.status"}
//           {"type": "ai.apple.generate", "system": "...", "prompt": "...", "maxTokens": 800}
// Response: {"ok": true, "available": true} / {"ok": true, "available": false, "reason": "<code>"}
//           {"ok": true, "text": "..."} or {"ok": false, "error": "<code>"}
// Reasons: device_not_eligible, not_enabled, model_not_ready, os_too_old, unknown.
enum AppleModelBridge {
    static func handles(_ message: Any?) -> Bool {
        guard let type = (message as? [String: Any])?["type"] as? String else { return false }
        return type == "ai.apple.status" || type == "ai.apple.generate"
    }

    static func handle(_ message: Any?) async -> [String: Any] {
        guard let m = message as? [String: Any], let type = m["type"] as? String else {
            return ["ok": false, "error": "bad_request"]
        }
        #if canImport(FoundationModels)
        if #available(iOS 26.0, macOS 26.0, *) {
            switch type {
            case "ai.apple.status":
                return status()
            case "ai.apple.generate":
                guard let prompt = m["prompt"] as? String, !prompt.isEmpty else {
                    return ["ok": false, "error": "bad_request"]
                }
                let maxTokens = (m["maxTokens"] as? Int) ?? 800
                return await generate(system: m["system"] as? String, prompt: prompt, maxTokens: maxTokens)
            default:
                return ["ok": false, "error": "unknown_type"]
            }
        }
        #endif
        return type == "ai.apple.status"
            ? ["ok": true, "available": false, "reason": "os_too_old"]
            : ["ok": false, "error": "unavailable"]
    }

    #if canImport(FoundationModels)
    @available(iOS 26.0, macOS 26.0, *)
    private static func status() -> [String: Any] {
        switch SystemLanguageModel.default.availability {
        case .available:
            return ["ok": true, "available": true]
        case .unavailable(let reason):
            let code: String
            switch reason {
            case .deviceNotEligible: code = "device_not_eligible"
            case .appleIntelligenceNotEnabled: code = "not_enabled"
            case .modelNotReady: code = "model_not_ready"
            @unknown default: code = "unknown"
            }
            return ["ok": true, "available": false, "reason": code]
        }
    }

    @available(iOS 26.0, macOS 26.0, *)
    private static func generate(system: String?, prompt: String, maxTokens: Int) async -> [String: Any] {
        guard case .available = SystemLanguageModel.default.availability else {
            return ["ok": false, "error": "unavailable"]
        }
        let session = system.map { LanguageModelSession(instructions: $0) } ?? LanguageModelSession()
        do {
            let response = try await session.respond(
                to: prompt,
                options: GenerationOptions(maximumResponseTokens: max(1, min(maxTokens, 4000)))
            )
            return ["ok": true, "text": response.content]
        } catch let error as LanguageModelSession.GenerationError {
            switch error {
            case .exceededContextWindowSize: return ["ok": false, "error": "too_long"]
            case .guardrailViolation: return ["ok": false, "error": "refused"]
            default: return ["ok": false, "error": "generation_failed"]
            }
        } catch {
            return ["ok": false, "error": "generation_failed"]
        }
    }
    #endif
}
