# iOS app + extension: shared Keychain access group entitlement and the
# KEYCHAIN_GROUP build setting read at runtime via Info.plist. macOS targets
# are left without it (needs a provisioning profile; launch-blockers 2, 14).
# Idempotent.
require 'xcodeproj'
path = File.expand_path('../apple/SafariScout.xcodeproj', __dir__)
project = Xcodeproj::Project.open(path)
['Safari Scout (iOS)', 'Safari Scout Extension (iOS)'].each do |name|
  t = project.targets.find { |x| x.name == name }
  t.build_configurations.each do |c|
    c.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'iOS-Shared.entitlements'
    c.build_settings['KEYCHAIN_GROUP'] = '$(AppIdentifierPrefix)com.example.AssistAnt.shared'
  end
end
project.save
puts 'ok'
