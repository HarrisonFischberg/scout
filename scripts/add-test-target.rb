# Adds a standalone macOS unit-test bundle (SafariScoutTests) to the Xcode
# project and a shared scheme that runs it. Idempotent.
require 'xcodeproj'
path = File.expand_path('../apple/SafariScout.xcodeproj', __dir__)
project = Xcodeproj::Project.open(path)
exit 0 if project.targets.any? { |t| t.name == 'SafariScoutTests' }

target = project.new_target(:unit_test_bundle, 'SafariScoutTests', :osx, '14.0')
group = project.main_group.find_subpath('Tests', true)
group.set_source_tree('<group>')
group.set_path('Tests')
%w[KeychainStoreTests.swift].each do |f|
  target.add_file_references([group.new_reference(f)])
end
# Code under test is compiled in directly (no host app, no @testable import).
project.files.select { |f| %w[KeychainStore.swift].include?(f.path.to_s.split('/').last) }
       .uniq { |f| f.path.to_s.split('/').last }
       .each { |ref| target.source_build_phase.add_file_reference(ref) }
target.build_configurations.each do |c|
  c.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.example.SafariScoutTests'
  c.build_settings['SWIFT_VERSION'] = '5.0'
  c.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
  c.build_settings['CODE_SIGN_STYLE'] = 'Manual'
  c.build_settings['CODE_SIGN_IDENTITY'] = '-'
end
project.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.save_as(path, 'SafariScoutTests', true)
puts 'added SafariScoutTests'
