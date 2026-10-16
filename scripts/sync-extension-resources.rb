# Adds every file `npm run build` writes to apple/Extension/Resources to both
# Safari extension targets' Copy Bundle Resources. Idempotent. Run after
# adding a new build output (T018: content.js and the legal pages were missing
# from the bundles, so the agent and legal links failed on device).
require 'xcodeproj'
root = File.expand_path('..', __dir__)
path = File.join(root, 'apple/SafariScout.xcodeproj')
project = Xcodeproj::Project.open(path)
targets = project.targets.select { |t| t.name.start_with?('Scout for Safari Extension') }
existing = targets.first.resources_build_phase.files_references
group = existing.first.parent
built = Dir.children(File.join(root, 'apple/Extension/Resources')).reject { |f| f.start_with?('.') }.sort
built.each do |name|
  ref = group.files.find { |r| r.path == name } || group.new_reference(name)
  # Directories (e.g. icons/) are copied as folder references.
  ref.last_known_file_type = 'folder' if File.directory?(File.join(root, 'apple/Extension/Resources', name))
  targets.each do |t|
    t.add_resources([ref]) unless t.resources_build_phase.files_references.include?(ref)
  end
end
project.save
puts "resources: #{built.join(', ')}"
