import Foundation
import Security

// Generic-password Keychain wrapper for provider API keys (T004).
// The key lives only here. It is never written to storage.local, logs, or prompts.
struct KeychainStore {
    enum KeychainError: Error, Equatable {
        case unexpectedStatus(OSStatus)
        case invalidData
    }

    let service: String
    // Set to the shared app group once the host app writes keys (T006).
    let accessGroup: String?

    init(service: String = "com.example.AssistAnt.provider-key", accessGroup: String? = nil) {
        self.service = service
        self.accessGroup = accessGroup
    }

    private func query(account: String) -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let accessGroup { q[kSecAttrAccessGroup as String] = accessGroup }
        return q
    }

    func set(_ value: String, account: String) throws {
        guard let data = value.data(using: .utf8) else { throw KeychainError.invalidData }
        let update = SecItemUpdate(
            query(account: account) as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else { throw KeychainError.unexpectedStatus(update) }
        var add = query(account: account)
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError.unexpectedStatus(status) }
    }

    func get(account: String) throws -> String? {
        var q = query(account: account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainError.unexpectedStatus(status) }
        guard let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
            throw KeychainError.invalidData
        }
        return value
    }

    func delete(account: String) throws {
        let status = SecItemDelete(query(account: account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unexpectedStatus(status)
        }
    }
}

// Pure message dispatch so XCTest covers it without an NSExtensionContext.
// Request:  {"type": "keychain.set|get|delete", "account": "<provider>", "value": "<key>"}
// Response: {"ok": true, "value": "<key>"?} or {"ok": false, "error": "<code>"}
enum KeychainBridge {
    static func handle(_ message: Any?, store: KeychainStore = KeychainStore()) -> [String: Any] {
        guard let m = message as? [String: Any],
              let type = m["type"] as? String,
              let account = m["account"] as? String, !account.isEmpty else {
            return ["ok": false, "error": "bad_request"]
        }
        do {
            switch type {
            case "keychain.set":
                guard let value = m["value"] as? String, !value.isEmpty else {
                    return ["ok": false, "error": "bad_request"]
                }
                try store.set(value, account: account)
                return ["ok": true]
            case "keychain.get":
                if let value = try store.get(account: account) { return ["ok": true, "value": value] }
                return ["ok": true]
            case "keychain.delete":
                try store.delete(account: account)
                return ["ok": true]
            default:
                return ["ok": false, "error": "unknown_type"]
            }
        } catch {
            return ["ok": false, "error": "keychain_error"]
        }
    }
}
