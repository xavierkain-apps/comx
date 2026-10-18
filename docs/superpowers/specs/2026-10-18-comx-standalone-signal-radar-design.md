# ComX as a standalone app, "Signal · Radar" redesign

Date: 2026-10-18. Status: approved by the owner in conversation, to be split
into one implementation plan per step.

## Goal

ComX becomes an app of its own, separate from SoarX Voice in code, builds and
look:

- **SoarX Voice**: phone only, live voice with friends. Not changed by this
  work.
- **ComX** (`com.xavier.comx`, "ComX Rider"): phone (iOS, Android) and watches
  (Apple Watch, Wear OS, Garmin). Friends on a radar, short voice memos,
  quick messages, SOS, and live voice between phones.

The visual direction is "2b Signal · Radar" from
`design_handoff_comx_signal_radar/` (README + HTML reference), extended to
Wear OS and Garmin.

## Features per platform

| | Phone (iOS, Android) | Apple Watch | Wear OS | Garmin |
|---|---|---|---|---|
| Riders radar (distance, bearing) | full screen | yes | yes | yes |
| Live group voice | TALK button | no (hears clips) | no | no |
| Voice memos (group or one rider) | MEMO button | TALK page + Action button | yes | no (no microphone) |
| Replay (history) | MSG sheet | History page | History page | no |
| Quick messages, SOS | yes | yes | yes | yes |

No server: the Agora channel carries positions, messages and memos (data
stream) and live voice (Agora audio), as today.

## Step 1: repository and builds

Owner: the ComX server session (it holds the signing and CI knowledge).

- New **public** repository `xavierkain-apps/comx` (owner's choice), created
  from branch `comx` of `xavierkain-apps/soarx-voice` with its history. Public
  because, on the GitHub Free plan, organisation secrets are only available
  to public repositories; the code and the test APKs are visible to anyone,
  as they are today with `soarx-voice`. `.env` and keys stay out of the
  repository.
- Remove what only serves SoarX Voice: the `iOS — TestFlight` and
  `Android — Release` workflows and the SoarX fastlane lanes.
- Workflows: ComX TestFlight (tag), Android phone + Wear APKs, Garmin build,
  quick checks (`tsc`, `eslint`, `jest`), iOS watch build check.
- Secrets: organisation secrets where they exist; any missing one is set by
  the owner in the repository from the originals (values cannot be read
  back): `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64`, `APPLE_TEAM_ID`,
  `MATCH_PASSWORD`, `MATCH_GIT_URL`, `MATCH_GIT_TOKEN`, `AGORA_APP_ID`.
- Once the new repository builds and ships a TestFlight build, branch `comx`
  of `soarx-voice` is frozen; CLAUDE.md is updated to say so.

## Visual system (all platforms)

Single dark palette, from the handoff (no light mode):

| Token | Hex | Use |
|---|---|---|
| bg | `#071518` | Background (watch may use `#000` for always-on) |
| surface | `#0F2327` | Bottom sheet, cards |
| surfaceAlt | `#12282C` | Chips, round secondary buttons, history highlight |
| ring | `#16343A` | Radar rings |
| outline | `#2A4448` | Ghost borders, sheet grabber |
| text | `#EAF4F3` | Primary text, "me" arrow |
| textMuted | `#7FA3A6` | Labels |
| textDim | `#4E7276` | Ring labels |
| teal | `#2ED3C4` | Riders, Talk, Join, live state |
| yellow | `#FFD23F` | Someone speaking |
| red | `#FF453A` | SOS, north mark |
| onAccent | `#071518` | Text on teal or yellow |

Fonts:

- Phone and Wear OS: Barlow and Barlow Condensed (OFL), bundled; headings,
  names, distances and button labels in condensed uppercase.
- Apple Watch: system font with `.width(.condensed)`.
- Garmin: device fonts, same palette (Connect IQ custom fonts are bitmap and
  costly).

Radar maths: the watch `OverviewPage` algorithm (square-root distance,
farthest rider on the outer ring, round inner ring distance, badges pushed
apart and kept inside the ring) is the reference. It is ported as is to
TypeScript (phone) and Kotlin (Wear OS), each with unit tests on the same
cases so the three platforms place riders the same way.

## Step 2: Apple Watch restyle

Navigation unchanged: paged ScrollView (talk page above the radar, crown both
ways), horizontal pages Riders, Messages, History, Action button Talk control.

- Radar: rings 3 pt (outer) and 2 pt, white "me" arrow, 34 pt badges (teal,
  yellow when speaking, red and bigger in SOS) with initials in onAccent, the
  distance under each badge without a capsule.
- Talk page: overline "CHANNEL · GROUP" (or the recipient while recording,
  name in yellow), 150 pt teal circle "TALK" with "Action button" under it;
  red "SEND n" while recording.
- History: "HISTORY" overline, 26 pt marker (yellow dot = voice, tap to
  replay; teal ring = text), "NAME · HH:MM" title, summary under it; the
  newest voice row on surfaceAlt.
- Rider page (name 26, teal arrow, distance 40), Messages (surfaceAlt pills,
  red "HOLD · SOS" with the 1.2 s press and confirmation), SOS alert (full
  red, white arrow, distance), speaking banner (yellow).

## Step 3: phone (React Native, iOS and Android)

### Join (replaces `HomeScreen`)

As in the handoff: "COMX" and "Settings" on top, the channel code in the
middle of three rings (suffix after the last "-" in teal, tap to edit, same
validation), favourite channels as pills with an "EDIT" ghost pill (manage
favourites, random channel), "Riding as <name>" (tap to edit), 72 pt JOIN
button ("CONNECTING…" while joining, disabled when it cannot join).

### Live (replaces `VoiceScreen`, `PilotList`, `MuteButton`, `RideBar`)

- Full-screen radar, ported maths; channel name and "● N RIDERS" top left
  (amber "RECONNECTING…", red "CONNECTION LOST"), arrow mode top right.
- Bottom sheet with three detents (controls only, about 370 pt, 90 %): rider
  rows (arrow, name, distance; yellow row while speaking, red row in SOS,
  "No GPS" rows dimmed), sorted as `buildRiderViews` does (SOS first, then
  nearest).
- Control row: **SOS** (68 pt circle, 1 s long press, "CANCEL" while active),
  **TALK** (live voice, unchanged behaviour; "WATCH MODE" pill when the
  watch has the microphone), **MEMO**, **MSG**.
- Banners (inactivity, call interruption, location denied): amber pill under
  the top overlay.

### Voice memos on the phone

- MEMO: first tap records (button turns red with a 30 s countdown, the live
  microphone is muted while recording), second tap sends. Default recipient
  is the group; tapping a rider row while recording sends to that rider only.
- Received memos (from a phone or a watch) play automatically, are forwarded
  to the paired watch and go into the history.
- Transport: the existing data-stream clip slicing (`src/ride/voiceClips.ts`,
  600 base64 characters per message, 150 ms apart) is extended to the group:
  `to: 0` means every rider (Agora never assigns uid 0), any other value is a
  private clip as today. About 3 s to send 10 s
  of voice; clips are capped at 30 s.
- Change from today: a watch memo to the group becomes a real memo that every
  phone receives, plays, keeps in its history and forwards to its watch,
  instead of being mixed into the live audio. The protocol version is bumped;
  every rider must run the new ComX.

### MSG sheet

Quick messages as large pills, the history (texts, SOS, memos with replay,
newest first, kept for the app's run like on the watch), speaker toggle, and
"Leave group" in red with a confirmation.

## Step 4: Wear OS

Same structure as the Apple Watch: a vertical pager with the Talk page above
the radar (rotary input or swipe), the radar as the opening page, rider pages
under it; horizontal pages Riders, Messages, History (replay). Same palette
and Barlow fonts (Compose). While ComX is in front, the watch's secondary
hardware buttons (`KEYCODE_STEM_1` …) start and send a memo, the Wear OS
counterpart of the Action button.

## Step 5: Garmin

Same palette on the existing button-only app: a radar page with coloured
dots and distances, the rider list, quick messages and SOS. No audio, so no
memos and no voice history.

## Testing and delivery

- Unit tests: radar maths in TypeScript, Swift and Kotlin on shared cases;
  group memo slicing and reassembly; history trimming.
- Each step is checked in simulators before it is shipped: iPhone + Apple
  Watch in demo mode (UI tests for the crown and the Action button), paired
  Android + Wear OS emulators, Garmin simulator if the Connect IQ SDK is
  installed locally, otherwise the CI build.
- Each step ships a TestFlight build or APKs and is tried by the owner on the
  water before the next step starts.
- Order: step 1 repository, step 2 Apple Watch, step 3 phone, step 4 Wear OS,
  step 5 Garmin. Step 2 can run while step 1 is in progress (watch code only).

## Out of scope

- Live calls from the watch (needs VoIP, a relay server and a custom audio
  client; see the discussion of 2026-10-18).
- Profile pictures on the radar (the data stream cannot carry them).
- Any change to SoarX Voice.
