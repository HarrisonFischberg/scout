# Adds the iOS UI-test bundle (AssistAntUITests) that drives the host app,
# bundles docs/legal/*.md into both App targets for the S09 sheet, and
# writes a shared scheme for the UI tests. Idempotent.
require 'xcodeproj'
path = File.expand_path('../apple/AssistAnt.xcodeproj', __dir__)
project = Xcodeproj::Project.open(path)

legal = project.main_group.find_subpath('Legal', true)
legal.set_source_tree('<group>')
legal.set_path('../docs/legal')
%w[privacy-policy.md terms.md].each do |f|
  ref = legal.files.find { |r| r.path == f } || legal.new_reference(f)
  ['AssistAnt (macOS)', 'AssistAnt (iOS)'].each do |name|
    t = project.targets.find { |x| x.name == name }
    t.add_resources([ref]) unless t.resources_build_phase.files_references.include?(ref)
  end
end

unless project.targets.any? { |t| t.name == 'AssistAntUITests' }
  app = project.targets.find { |t| t.name == 'AssistAnt (iOS)' }
  target = project.new_target(:ui_test_bundle, 'AssistAntUITests', :ios, '17.0')
  group = project.main_group.find_subpath('UITests', true)
  group.set_source_tree('<group>')
  group.set_path('UITests')
  target.add_file_references([group.new_reference('HostAppAccessibilityUITests.swift')])
  target.add_dependency(app)
  target.build_configurations.each do |c|
    c.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.example.AssistAntUITests'
    c.build_settings['TEST_TARGET_NAME'] = app.name
    c.build_settings['SWIFT_VERSION'] = '5.0'
    c.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
    c.build_settings['TARGETED_DEVICE_FAMILY'] = '1,2'
  end
  scheme = Xcodeproj::XCScheme.new
  scheme.add_build_target(app)
  scheme.add_test_target(target)
  scheme.set_launch_target(app)
  scheme.save_as(path, 'AssistAntUITests', true)
end
project.save
puts 'ok'
