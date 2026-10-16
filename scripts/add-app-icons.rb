# Adds apple/App/Assets.xcassets (AppIcon) to both host-app targets' resources.
# ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon was already set, but no catalog
# existed, so macOS showed a blank icon (Dock, Command-Tab). Idempotent.
require 'xcodeproj'
path = File.expand_path('../apple/SafariScout.xcodeproj', __dir__)
project = Xcodeproj::Project.open(path)
app_group = project.main_group.find_subpath('App', false) || project.main_group
ref = project.files.find { |f| f.path.to_s.end_with?('Assets.xcassets') } ||
      app_group.new_reference('Assets.xcassets')
ref.last_known_file_type = 'folder.assetcatalog'
['Scout for Safari (macOS)', 'Scout for Safari (iOS)'].each do |name|
  t = project.targets.find { |x| x.name == name }
  t.add_resources([ref]) unless t.resources_build_phase.files_references.include?(ref)
end
project.save
puts "asset catalog: #{ref.real_path}"
