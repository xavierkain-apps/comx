#!/usr/bin/env ruby
# frozen_string_literal: true

# Adds the WidgetKit extension (SoarXVoiceWatchControls: complication and
# watchOS 26 controls) to
# ios/SoarXVoice.xcodeproj and embeds it in the watch app. Idempotent. Run
# scripts/add-watch-target.rb first: the watch target must exist.
#
#   gem install --user-install xcodeproj
#   ruby scripts/add-watch-controls-target.rb
#
# What it does:
#   1. Creates the SoarXVoiceWatchControls target: a WidgetKit extension
#      (watchOS 10+, like the watch app, so older watches get the complication
#      and the extension never gets in the way of installing the app; the
#      control itself is gated to watchOS 26 in code), bundle id
#      com.xavier.comx.watchkitapp.controls. Every
#      *.swift in ios/SoarXVoiceWatchControls is compiled, plus the intents
#      shared with the watch app (SHARED_FILES), with COMX_CONTROLS_EXTENSION
#      defined so their app-only code is left out.
#   2. Embeds it in the watch app ("Embed Foundation Extensions") and makes
#      the watch target depend on it.
#
# See docs/watch-ios.md ("Apple Watch Ultra Action button").

require "xcodeproj"

ROOT = File.expand_path("..", __dir__)
IOS_DIR = File.join(ROOT, "ios")
PROJECT_PATH = File.join(IOS_DIR, "SoarXVoice.xcodeproj")

WATCH_TARGET = "SoarXVoiceWatch"
WATCH_DIR = "SoarXVoiceWatch" # relative to ios/
EXT_TARGET = "SoarXVoiceWatchControls"
EXT_DIR = "SoarXVoiceWatchControls" # relative to ios/
EXT_BUNDLE_ID = "com.xavier.comx.watchkitapp.controls"
EXT_WATCHOS_VERSION = "10.0"
TEAM_ID = "S96H22CQ8W"
EMBED_PHASE = "Embed Foundation Extensions"

# Watch app files the extension compiles too (the control's intent).
SHARED_FILES = %w[TalkControl.swift].freeze

project = Xcodeproj::Project.open(PROJECT_PATH)
watch_target = project.targets.find { |t| t.name == WATCH_TARGET } \
  or abort("No #{WATCH_TARGET} target: run scripts/add-watch-target.rb first")
changes = []

# --- 1. Extension target -----------------------------------------------------

ext_target = project.targets.find { |t| t.name == EXT_TARGET }
unless ext_target
  ext_target = project.new_target(:app_extension, EXT_TARGET, :watchos, EXT_WATCHOS_VERSION, nil, :swift)
  # new_target links Foundation through an SDK-versioned path; the sources
  # import what they need, so drop it.
  ext_target.frameworks_build_phase.files.dup.each(&:remove_from_project)
  changes << "target #{EXT_TARGET}"
end

project.frameworks_group.children.dup.each do |child|
  next unless child.isa == "PBXGroup" && child.display_name == "watchOS"

  child.files.dup.each { |f| f.build_files.each(&:remove_from_project); f.remove_from_project }
  child.remove_from_project if child.children.empty?
  changes << "removed watchOS SDK framework refs"
end

watch_attrs = watch_target.build_configurations.first.build_settings
marketing_version = watch_attrs["MARKETING_VERSION"] or abort("#{WATCH_TARGET} has no MARKETING_VERSION")
build_number = watch_attrs["CURRENT_PROJECT_VERSION"] or abort("#{WATCH_TARGET} has no CURRENT_PROJECT_VERSION")

ext_settings = {
  "PRODUCT_NAME" => "$(TARGET_NAME)",
  "PRODUCT_BUNDLE_IDENTIFIER" => EXT_BUNDLE_ID,
  "SDKROOT" => "watchos",
  "SUPPORTED_PLATFORMS" => "watchos watchsimulator",
  "TARGETED_DEVICE_FAMILY" => "4",
  "WATCHOS_DEPLOYMENT_TARGET" => EXT_WATCHOS_VERSION,
  "SKIP_INSTALL" => "YES",
  "APPLICATION_EXTENSION_API_ONLY" => "YES",
  "SWIFT_VERSION" => "5.0",
  "SWIFT_EMIT_LOC_STRINGS" => "YES",
  "LD_RUNPATH_SEARCH_PATHS" => ["$(inherited)", "@executable_path/Frameworks", "@executable_path/../../Frameworks"],
  "CODE_SIGN_STYLE" => "Automatic",
  "DEVELOPMENT_TEAM" => TEAM_ID,
  # Same as the watch app, which carries the iOS app's.
  "MARKETING_VERSION" => marketing_version,
  "CURRENT_PROJECT_VERSION" => build_number,
  "GENERATE_INFOPLIST_FILE" => "YES",
  "INFOPLIST_FILE" => "#{EXT_DIR}/Info.plist", # NSExtension (dictionary)
  "INFOPLIST_KEY_CFBundleDisplayName" => "ComX",
}

ext_target.build_configurations.each do |config|
  bs = config.build_settings
  bs.delete("ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES")
  ext_settings.each do |key, value|
    next if bs[key] == value
    bs[key] = value
    changes << "#{config.name}: #{key}" unless changes.include?("target #{EXT_TARGET}")
  end
  conditions = config.name == "Debug" ? "$(inherited) DEBUG COMX_CONTROLS_EXTENSION" : "$(inherited) COMX_CONTROLS_EXTENSION"
  unless bs["SWIFT_ACTIVE_COMPILATION_CONDITIONS"] == conditions
    bs["SWIFT_ACTIVE_COMPILATION_CONDITIONS"] = conditions
    changes << "#{config.name}: SWIFT_ACTIVE_COMPILATION_CONDITIONS" unless changes.include?("target #{EXT_TARGET}")
  end
  bs["SWIFT_OPTIMIZATION_LEVEL"] ||= "-Onone" if config.name == "Debug"
end

# Sources of the extension.
ext_group = project.main_group.children.find { |g| g.isa == "PBXGroup" && g.path == EXT_DIR } ||
            project.main_group.new_group(EXT_TARGET, EXT_DIR)

ext_abs = File.join(IOS_DIR, EXT_DIR)
swift_files = Dir.children(ext_abs).select { |f| f.end_with?(".swift") }.sort
abort("No Swift sources in ios/#{EXT_DIR}") if swift_files.empty?

(swift_files + %w[Info.plist]).each do |name|
  next if ext_group.files.find { |f| f.path == name }

  ext_group.new_reference(name)
  changes << "file ref #{EXT_DIR}/#{name}"
end

ext_group.files.dup.each do |ref|
  next if File.exist?(File.join(ext_abs, ref.path))

  ref.build_files.each(&:remove_from_project)
  ref.remove_from_project
  changes << "removed stale #{ref.path}"
end

swift_files.each do |name|
  ref = ext_group.files.find { |f| f.path == name }
  next if ext_target.source_build_phase.files_references.include?(ref)

  ext_target.source_build_phase.add_file_reference(ref)
  changes << "#{name} -> #{EXT_TARGET} Sources"
end

# Shared watch app files: same file references as the watch target uses.
watch_group = project.main_group.children.find { |g| g.isa == "PBXGroup" && g.path == WATCH_DIR } \
  or abort("No #{WATCH_DIR} group: run scripts/add-watch-target.rb first")
SHARED_FILES.each do |name|
  ref = watch_group.files.find { |f| f.path == name } \
    or abort("ios/#{WATCH_DIR}/#{name} is not in the project: run scripts/add-watch-target.rb first")
  next if ext_target.source_build_phase.files_references.include?(ref)

  ext_target.source_build_phase.add_file_reference(ref)
  changes << "#{WATCH_DIR}/#{name} -> #{EXT_TARGET} Sources"
end

# --- 2. Embed in the watch app -----------------------------------------------

unless watch_target.dependencies.any? { |d| d.target == ext_target }
  watch_target.add_dependency(ext_target)
  changes << "#{WATCH_TARGET} depends on #{EXT_TARGET}"
end

embed = watch_target.copy_files_build_phases.find { |p| p.name == EMBED_PHASE }
unless embed
  embed = watch_target.new_copy_files_build_phase(EMBED_PHASE)
  embed.symbol_dst_subfolder_spec = :plug_ins
  changes << "#{WATCH_TARGET} phase #{EMBED_PHASE}"
end
unless embed.files_references.include?(ext_target.product_reference)
  bf = embed.add_file_reference(ext_target.product_reference)
  bf.settings = {"ATTRIBUTES" => ["RemoveHeadersOnCopy"]}
  changes << "embed #{EXT_TARGET}.appex"
end

attributes = project.root_object.attributes["TargetAttributes"] ||= {}
unless attributes.dig(ext_target.uuid, "CreatedOnToolsVersion")
  attributes[ext_target.uuid] = {"CreatedOnToolsVersion" => "26.0"}
  changes << "target attributes"
end

if changes.empty?
  puts "Project already up to date."
else
  project.save
  puts "Updated #{PROJECT_PATH}:"
  changes.uniq.each { |c| puts "  - #{c}" }
end
