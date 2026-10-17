import Foundation

// Organization blocklist (Part 2, spec 10a). An administrator can push the
// key "ScoutBlockedSites" (an array of host names, e.g. "hr.example.com") in a
// configuration profile for the extension's bundle ID. Only a value the system
// marks as managed (forced) counts; the user cannot set or clear it. The
// extension enforces it on the device (src/permissions/gate.ts) and shows it
// read-only in Settings > Page access.
// Request:  {"type": "policy.get"}
// Response: {"ok": true, "blocked": ["<host>", ...]}
enum ManagedPolicy {
    static let blockedSitesKey = "ScoutBlockedSites"
    static let maxSites = 200

    /// Reply for a policy.get message; nil for any other message.
    static func handle(_ message: Any?, blockedSites: () -> [String] = managedBlockedSites) -> [String: Any]? {
        guard let m = message as? [String: Any], m["type"] as? String == "policy.get" else { return nil }
        let sites = blockedSites()
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && $0.count <= 253 }
        return ["ok": true, "blocked": Array(sites.prefix(maxSites))]
    }

    /// The managed value only: a default the user or an app wrote is ignored.
    static func managedBlockedSites() -> [String] {
        let defaults = UserDefaults.standard
        guard defaults.objectIsForced(forKey: blockedSitesKey) else { return [] }
        return (defaults.array(forKey: blockedSitesKey) ?? []).compactMap { $0 as? String }
    }
}
