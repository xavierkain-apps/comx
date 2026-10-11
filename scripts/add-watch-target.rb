#!/usr/bin/env ruby
# frozen_string_literal: true

# Adds the Apple Watch companion to ios/SoarXVoice.xcodeproj. Idempotent: run
# it again after adding a file to ios/SoarXVoiceWatch/ or after changing the
# iOS app's MARKETING_VERSION (the watch app must carry the same version).
#
#   gem install --user-install xcodeproj
#   ruby scripts/add-watch-target.rb
#
# What it does:
#   1. Compiles ios/WatchBridge.swift + .m into the SoarXVoice target (a file on
#      disk that is not in project.pbxproj is never compiled).
#   2. Creates the SoarXVoiceWatch target: a single-target SwiftUI watchOS app
#      (watchOS 10+), bundle id com.xavier.soarxvoice.watchkitapp, companion of
#      com.xavier.soarxvoice. Every *.swift in ios/SoarXVoiceWatch is compiled.
#   3. Embeds it in the iOS app ("Embed Watch Content") and makes the iOS
#      target depend on it, so building the iOS scheme builds the watch app.
#
# See docs/watch-ios.md.

require "xcodeproj"

ROOT = File.expand_path("..", __dir__)
IOS_DIR = File.join(ROOT, "ios")
PROJECT_PATH = File.join(IOS_DIR, "SoarXVoice.xcodeproj")

IOS_TARGET = "SoarXVoice"
WATCH_TARGET = "SoarXVoiceWatch"
WATCH_DIR = "SoarXVoiceWatch" # relative to ios/
IOS_BUNDLE_ID = "com.xavier.soarxvoice"
WATCH_BUNDLE_ID = "#{IOS_BUNDLE_ID}.watchkitapp"
WATCHOS_VERSION = "10.0"
TEAM_ID = "S96H22CQ8W"
EMBED_PHASE = "Embed Watch Content"

BRIDGE_FILES = %w[WatchBridge.swift WatchBridge.m].freeze

project = Xcodeproj::Project.open(PROJECT_PATH)
ios_target = project.targets.find { |t| t.name == IOS_TARGET } or abort("No #{IOS_TARGET} target")
changes = []

# --- 1. WatchBridge in the iOS target ---------------------------------------

# Existing native modules (AudioSessionManager, HapticManager, ...) live in
# ios/ and are listed in the path-less "SoarXVoice" group, so their paths
# resolve against ios/. Do the same.
app_group = project.main_group.children.find { |g| g.isa == "PBXGroup" && g.display_name == IOS_TARGET } \
  or abort("No #{IOS_TARGET} group")

BRIDGE_FILES.each do |name|
  abort("Missing ios/#{name}") unless File.exist?(File.join(IOS_DIR, name))
  ref = app_group.files.find { |f| f.path == name }
  unless ref
    ref = app_group.new_reference(name)
    ref.include_in_index = "1"
    changes << "file ref #{name}"
  end
  unless ios_target.source_build_phase.files_references.include?(ref)
    ios_target.source_build_phase.add_file_reference(ref)
    changes << "#{name} -> #{IOS_TARGET} Sources"
  end
end

# --- 2. watchOS app target ---------------------------------------------------

watch_target = project.targets.find { |t| t.name == WATCH_TARGET }
unless watch_target
  watch_target = project.new_target(:application, WATCH_TARGET, :watchos, WATCHOS_VERSION, nil, :swift)
  # new_target links Foundation through an SDK-versioned path; a SwiftUI app
  # imports what it needs, so drop it.
  watch_target.frameworks_build_phase.files.dup.each(&:remove_from_project)
  changes << "target #{WATCH_TARGET}"
end

# ...and the file reference / "watchOS" group it created under Frameworks.
project.frameworks_group.children.dup.each do |child|
  next unless child.isa == "PBXGroup" && child.display_name == "watchOS"

  child.files.dup.each { |f| f.build_files.each(&:remove_from_project); f.remove_from_project }
  child.remove_from_project if child.children.empty?
  changes << "removed watchOS SDK framework refs"
end

ios_attrs = ios_target.build_configurations.first.build_settings
marketing_version = ios_attrs["MARKETING_VERSION"] or abort("iOS target has no MARKETING_VERSION")
build_number = ios_attrs["CURRENT_PROJECT_VERSION"] or abort("iOS target has no CURRENT_PROJECT_VERSION")

watch_settings = {
  "PRODUCT_NAME" => "$(TARGET_NAME)",
  "PRODUCT_BUNDLE_IDENTIFIER" => WATCH_BUNDLE_ID,
  "SDKROOT" => "watchos",
  "SUPPORTED_PLATFORMS" => "watchos watchsimulator",
  "TARGETED_DEVICE_FAMILY" => "4",
  "WATCHOS_DEPLOYMENT_TARGET" => WATCHOS_VERSION,
  "SKIP_INSTALL" => "YES",
  "SWIFT_VERSION" => "5.0",
  "SWIFT_EMIT_LOC_STRINGS" => "YES",
  "ENABLE_PREVIEWS" => "YES",
  "LD_RUNPATH_SEARCH_PATHS" => ["$(inherited)", "@executable_path/Frameworks"],
  "ASSETCATALOG_COMPILER_APPICON_NAME" => "AppIcon",
  "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME" => "AccentColor",
  "CODE_SIGN_STYLE" => "Automatic",
  "CODE_SIGN_ENTITLEMENTS" => "#{WATCH_DIR}/SoarXVoiceWatch.entitlements",
  "DEVELOPMENT_TEAM" => TEAM_ID,
  # Must equal the iOS app's, or the embedded app is rejected. agvtool (used
  # by fastlane increment_build_number) bumps CURRENT_PROJECT_VERSION in every
  # target; MARKETING_VERSION is re-synced each time this script runs.
  "MARKETING_VERSION" => marketing_version,
  "CURRENT_PROJECT_VERSION" => build_number,
  "GENERATE_INFOPLIST_FILE" => "YES",
  "INFOPLIST_FILE" => "#{WATCH_DIR}/Info.plist", # WKBackgroundModes (array)
  "INFOPLIST_KEY_CFBundleDisplayName" => "SoarX Voice",
  "INFOPLIST_KEY_WKCompanionAppBundleIdentifier" => IOS_BUNDLE_ID,
  "INFOPLIST_KEY_WKRunsIndependentlyOfCompanionApp" => "NO",
  "INFOPLIST_KEY_UISupportedInterfaceOrientations" => "UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown",
  "INFOPLIST_KEY_NSMicrophoneUsageDescription" =>
    "SoarX Voice records your voice messages to the riders in your channel.",
  "INFOPLIST_KEY_NSLocationWhenInUseUsageDescription" =>
    "SoarX Voice uses the compass to point the arrows at the other riders.",
  "INFOPLIST_KEY_NSHealthShareUsageDescription" =>
    "SoarX Voice runs a water sports workout to stay on screen during your session.",
  "INFOPLIST_KEY_NSHealthUpdateUsageDescription" =>
    "SoarX Voice runs a water sports workout to stay on screen during your session. It does not save workouts.",
}

watch_target.build_configurations.each do |config|
  bs = config.build_settings
  bs.delete("ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES") # Swift ships with watchOS
  watch_settings.each do |key, value|
    next if bs[key] == value
    bs[key] = value
    changes << "#{config.name}: #{key}" unless changes.include?("target #{WATCH_TARGET}")
  end
  if config.name == "Debug"
    conditions = "$(inherited) DEBUG"
    bs["SWIFT_ACTIVE_COMPILATION_CONDITIONS"] = conditions unless bs["SWIFT_ACTIVE_COMPILATION_CONDITIONS"] == conditions
    bs["SWIFT_OPTIMIZATION_LEVEL"] ||= "-Onone"
  end
end

# Sources, assets and plist files of the watch app.
watch_group = project.main_group.children.find { |g| g.isa == "PBXGroup" && g.path == WATCH_DIR } ||
              project.main_group.new_group(WATCH_TARGET, WATCH_DIR)

watch_abs = File.join(IOS_DIR, WATCH_DIR)
swift_files = Dir.children(watch_abs).select { |f| f.end_with?(".swift") }.sort
abort("No Swift sources in ios/#{WATCH_DIR}") if swift_files.empty?

(swift_files + %w[Assets.xcassets Info.plist SoarXVoiceWatch.entitlements]).each do |name|
  abort("Missing ios/#{WATCH_DIR}/#{name}") unless File.exist?(File.join(watch_abs, name))
  ref = watch_group.files.find { |f| f.path == name }
  next if ref

  watch_group.new_reference(name)
  changes << "file ref #{WATCH_DIR}/#{name}"
end

# Drop references to files that no longer exist on disk.
watch_group.files.dup.each do |ref|
  next if File.exist?(File.join(watch_abs, ref.path))

  ref.build_files.each(&:remove_from_project)
  ref.remove_from_project
  changes << "removed stale #{ref.path}"
end

swift_files.each do |name|
  ref = watch_group.files.find { |f| f.path == name }
  next if watch_target.source_build_phase.files_references.include?(ref)

  watch_target.source_build_phase.add_file_reference(ref)
  changes << "#{name} -> #{WATCH_TARGET} Sources"
end

assets = watch_group.files.find { |f| f.path == "Assets.xcassets" }
unless watch_target.resources_build_phase.files_references.include?(assets)
  watch_target.resources_build_phase.add_file_reference(assets)
  changes << "Assets.xcassets -> #{WATCH_TARGET} Resources"
end

# --- 3. Embed in the iOS app -------------------------------------------------

unless ios_target.dependencies.any? { |d| d.target == watch_target }
  ios_target.add_dependency(watch_target)
  changes << "#{IOS_TARGET} depends on #{WATCH_TARGET}"
end

embed = ios_target.copy_files_build_phases.find { |p| p.name == EMBED_PHASE }
unless embed
  embed = project.new(Xcodeproj::Project::Object::PBXCopyFilesBuildPhase)
  embed.name = EMBED_PHASE
  embed.symbol_dst_subfolder_spec = :products_directory
  embed.dst_path = "$(CONTENTS_FOLDER_PATH)/Watch"
  # Right after Resources, like Xcode's own template.
  index = ios_target.build_phases.index(ios_target.resources_build_phase) || (ios_target.build_phases.count - 1)
  ios_target.build_phases.insert(index + 1, embed)
  changes << "#{IOS_TARGET} phase #{EMBED_PHASE}"
end
unless embed.files_references.include?(watch_target.product_reference)
  bf = embed.add_file_reference(watch_target.product_reference)
  bf.settings = {"ATTRIBUTES" => ["RemoveHeadersOnCopy"]}
  changes << "embed #{WATCH_TARGET}.app"
end

attributes = project.root_object.attributes["TargetAttributes"] ||= {}
unless attributes.dig(watch_target.uuid, "CreatedOnToolsVersion")
  attributes[watch_target.uuid] = {"CreatedOnToolsVersion" => "15.0"}
  changes << "target attributes"
end

if changes.empty?
  puts "Project already up to date."
else
  project.save
  puts "Updated #{PROJECT_PATH}:"
  changes.uniq.each { |c| puts "  - #{c}" }
end
