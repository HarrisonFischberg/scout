# Adds ManagedPolicy.swift (Part 2 organization blocklist) to both Safari
# extension targets and the unit-test target, and ManagedPolicyTests.swift to
# the unit-test target. Idempotent.
require 'xcodeproj'
path = File.expand_path('../apple/SafariScout.xcodeproj', __dir__)
project = Xcodeproj::Project.open(path)
handler = project.files.find { |f| f.path.to_s.end_with?('SafariWebExtensionHandler.swift') }
ext_group = handler.parent
policy = ext_group.files.find { |f| f.path == 'ManagedPolicy.swift' } || ext_group.new_reference('ManagedPolicy.swift')
tests_group = project.main_group.find_subpath('Tests', false)
policy_tests = tests_group.files.find { |f| f.path == 'ManagedPolicyTests.swift' } || tests_group.new_reference('ManagedPolicyTests.swift')
project.targets.each do |t|
  refs = t.source_build_phase.files_references
  if t.name.start_with?('Scout for Safari Extension')
    t.source_build_phase.add_file_reference(policy) unless refs.include?(policy)
  elsif t.name == 'SafariScoutTests'
    t.source_build_phase.add_file_reference(policy) unless refs.include?(policy)
    t.source_build_phase.add_file_reference(policy_tests) unless refs.include?(policy_tests)
  end
end
project.save
puts 'ManagedPolicy.swift added'
