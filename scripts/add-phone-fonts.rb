#!/usr/bin/env ruby
# frozen_string_literal: true

# Bundles the Barlow fonts (assets/fonts/*.ttf, SIL Open Font Licence) into
# the SoarXVoice iOS target and lists them under UIAppFonts. Idempotent: run
# it again after adding a font. Android reads the same files through
# android/app/build.gradle (assets srcDirs).
#
#   bundle exec ruby scripts/add-phone-fonts.rb

require "xcodeproj"

ROOT = File.expand_path("..", __dir__)
PROJECT_PATH = File.join(ROOT, "ios", "SoarXVoice.xcodeproj")
PLIST_PATH = File.join(ROOT, "ios", "SoarXVoice", "Info.plist")
IOS_TARGET = "SoarXVoice"
GROUP_NAME = "Fonts"

fonts = Dir[File.join(ROOT, "assets", "fonts", "*.ttf")].map { |p| File.basename(p) }.sort
abort("No fonts in assets/fonts") if fonts.empty?

project = Xcodeproj::Project.open(PROJECT_PATH)
target = project.targets.find { |t| t.name == IOS_TARGET } or abort("No #{IOS_TARGET} target")

# The main group's paths resolve against ios/, so the fonts are ../assets/fonts.
group = project.main_group.children.find { |g| g.isa == "PBXGroup" && g.display_name == GROUP_NAME } ||
        project.main_group.new_group(GROUP_NAME, "../assets/fonts")

fonts.each do |name|
  ref = group.files.find { |f| f.path == name } || group.new_reference(name)
  next if target.resources_build_phase.files_references.include?(ref)

  target.resources_build_phase.add_file_reference(ref, true)
  puts "#{name} -> #{IOS_TARGET} Resources"
end
project.save

# Info.plist is edited as text (plutil would reorder and reformat the file):
# add the UIAppFonts array before the final </dict>, or only the missing
# <string> entries if it is already there. Written only when it changed.
plist = File.read(PLIST_PATH)
updated =
  if (m = plist.match(%r{(<key>UIAppFonts</key>\s*<array>)(.*?)(\n?[ \t]*</array>)}m))
    listed = m[2].scan(%r{<string>(.*?)</string>}).flatten
    missing = fonts - listed
    added = missing.map { |f| "\n\t\t<string>#{f}</string>" }.join
    missing.empty? ? plist : plist.sub(m[0], "#{m[1]}#{m[2]}#{added}#{m[3]}")
  else
    entries = fonts.map { |f| "\t\t<string>#{f}</string>\n" }.join
    block = "\t<key>UIAppFonts</key>\n\t<array>\n#{entries}\t</array>\n"
    at = plist.rindex("</dict>") or abort("No </dict> in #{PLIST_PATH}")
    plist[0...at] + block + plist[at..]
  end
if updated == plist
  puts "UIAppFonts: already lists #{fonts.join(', ')}"
else
  File.write(PLIST_PATH, updated)
  puts "UIAppFonts: #{fonts.join(', ')}"
end
