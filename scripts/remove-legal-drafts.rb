# App Store prep (docs/app-store-submission.md): the app and extension link to
# the published privacy policy instead of bundling the legal drafts, so the
# draft Markdown (Legal group) and the generated privacy.html / terms.html
# leave every target's resources. Idempotent.
require 'xcodeproj'
path = File.expand_path('../apple/SafariScout.xcodeproj', __dir__)
project = Xcodeproj::Project.open(path)
drafts = %w[privacy-policy.md terms.md privacy.html terms.html]
project.files.select { |f| drafts.include?(File.basename(f.path.to_s)) }.each do |ref|
  project.targets.each do |t|
    t.resources_build_phase.files.select { |bf| bf.file_ref == ref }.each(&:remove_from_project)
  end
  ref.remove_from_project
end
legal = project.main_group.children.find { |g| g.display_name == 'Legal' }
legal.remove_from_project if legal && legal.children.empty?
project.save
puts 'ok'
