# TestFlight / App Store upload prep (launch blockers 2, 11):
# - macOS app and extension use the owner's team and the same bundle IDs as
#   iOS, so one App Store Connect record covers both platforms. Changing the
#   Mac IDs makes the installed Mac build forget its saved key once, and
#   Safari registers the extension as new.
# - Adds the privacy manifests (UserDefaults is a required-reason API) to the
#   app and extension resources on both platforms. Idempotent.
require 'xcodeproj'
TEAM = 'KTV2G3Z883'
PREFIX = 'com.harrisonfischberg'
ids = {
  'Scout for Safari (macOS)' => "#{PREFIX}.SafariScout",
  'Scout for Safari Extension (macOS)' => "#{PREFIX}.SafariScout.Extension",
}
manifests = {
  'App' => ['Scout for Safari (macOS)', 'Scout for Safari (iOS)'],
  'Extension' => ['Scout for Safari Extension (macOS)', 'Scout for Safari Extension (iOS)'],
}
path = File.expand_path('../apple/SafariScout.xcodeproj', __dir__)
project = Xcodeproj::Project.open(path)
target = ->(name) { project.targets.find { |x| x.name == name } or abort "missing target #{name}" }
ids.each do |name, id|
  target[name].build_configurations.each do |c|
    c.build_settings['DEVELOPMENT_TEAM'] = TEAM
    c.build_settings['CODE_SIGN_STYLE'] = 'Automatic'
    c.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = id
  end
end
manifests.each do |group_name, targets|
  group = project.main_group.find_subpath(group_name, false) or abort "missing group #{group_name}"
  ref = group.files.find { |f| f.path == 'PrivacyInfo.xcprivacy' } || group.new_reference('PrivacyInfo.xcprivacy')
  ref.last_known_file_type = 'text.xml'
  targets.each do |name|
    t = target[name]
    t.add_resources([ref]) unless t.resources_build_phase.files_references.include?(ref)
  end
end
project.save
puts 'ok'
