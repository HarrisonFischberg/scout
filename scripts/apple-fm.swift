import Foundation
import FoundationModels
// Live-eval helper (scripts/live-qa.mjs --apple): reads {"system","prompt","maxTokens"} JSON lines on stdin and writes {"ok","text"|"error","ms"} lines, using the same FoundationModels calls as apple/Extension/AppleModelBridge.swift. Needs macOS 26+ with Apple Intelligence, outside the Claude Code sandbox.
@main struct FM {
  static func main() async {
    let m = SystemLanguageModel.default
    guard case .available = m.availability else { print("{\"ok\":false,\"error\":\"unavailable: \(m.availability)\"}"); return }
    while let line = readLine() {
      let req = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any] ?? [:]
      let t0 = Date()
      var out: [String: Any] = [:]
      do {
        let s = (req["system"] as? String).map { LanguageModelSession(instructions: $0) } ?? LanguageModelSession()
        let r = try await s.respond(to: req["prompt"] as? String ?? "", options: GenerationOptions(maximumResponseTokens: (req["maxTokens"] as? Int) ?? 700))
        out = ["ok": true, "text": r.content]
      } catch let e as LanguageModelSession.GenerationError {
        switch e { case .exceededContextWindowSize: out = ["ok": false, "error": "too_long"]; case .guardrailViolation: out = ["ok": false, "error": "refused"]; default: out = ["ok": false, "error": "generation_failed", "detail": String(describing: e)] }
      } catch { out = ["ok": false, "error": "generation_failed", "detail": String(describing: error)] }
      out["ms"] = Int(Date().timeIntervalSince(t0) * 1000)
      let d = try! JSONSerialization.data(withJSONObject: out)
      print(String(data: d, encoding: .utf8)!)
      fflush(stdout)
    }
  }
}
