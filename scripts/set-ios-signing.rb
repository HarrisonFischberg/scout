# iOS app, extension and UI tests: owner's team and bundle ID prefix, so
# Xcode's automatic signing can install on a device (launch-blockers 2, 11).
# macOS targets moved to the same IDs in scripts/prepare-testflight.rb.
# Idempotent.
require 'xcodeproj'
TEAM = 'KTV2G3Z883'
PREFIX = 'com.harrisonfischberg'
ids = {
  'Scout for Safari (iOS)' => "#{PREFIX}.SafariScout",
  'Scout for Safari Extension (iOS)' => "#{PREFIX}.SafariScout.Extension",
  'SafariScoutUITests' => "#{PREFIX}.SafariScoutUITests",
}
path = File.expand_path('../apple/SafariScout.xcodeproj', __dir__)
project = Xcodeproj::Project.open(path)
ids.each do |name, id|
  t = project.targets.find { |x| x.name == name } or abort "missing target #{name}"
  t.build_configurations.each do |c|
    c.build_settings['DEVELOPMENT_TEAM'] = TEAM
    c.build_settings['CODE_SIGN_STYLE'] = 'Automatic'
    c.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = id
  end
end
project.save
puts 'ok'
