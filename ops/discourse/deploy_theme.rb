# frozen_string_literal: true

# Update the existing theme in place so users who selected it keep that
# selection. Keep the previous source and assets for browser-test rollback.
require "fileutils"

root = Pathname.new(ENV.fetch("GQ_THEME_RELEASE"))
previous = root.join("previous")
theme = Theme.find_by!(name: "GraviQuest Community", id: SiteSetting.default_theme_id)
mode = ENV.fetch("GQ_THEME_MODE")

case mode
when "apply"
  candidate = root.join("candidate")
  raise "Theme release already exists" if previous.exist?

  exporter = ThemeStore::ZipExporter.new(theme)
  exporter.with_export_dir do |directory|
    FileUtils.cp_r(directory, root.join("previous-pending"))
  end
  File.rename(root.join("previous-pending"), previous)
when "rollback"
  exit unless previous.join("about.json").file?
  candidate = previous
else
  raise "Unknown theme release action"
end

metadata = JSON.parse(candidate.join("about.json").read)
raise "Unexpected theme source" unless metadata["name"] == theme.name

Theme.transaction do
  updated = RemoteTheme.import_theme_from_directory(candidate.to_s, theme_id: theme.id)
  raise "Theme import failed" unless updated.persisted? && updated.errors.empty?
  updated.update_javascript_cache!
  compiled = updated.javascript_cache&.content.to_s
  raise "Theme JavaScript compilation failed: #{compiled.first(500)}" if compiled.blank? || compiled.start_with?("throw new Error(")
  updated.theme_fields.each(&:ensure_baked!)
  raise "Theme field compilation failed" if updated.theme_fields.where.not(error: [nil, ""]).exists?
  %i[common_theme desktop_theme mobile_theme].each do |target|
    Stylesheet::Manager.new(theme_id: updated.id).stylesheet_data(target)
  end
end

puts "GraviQuest theme #{mode} compiled in place"
