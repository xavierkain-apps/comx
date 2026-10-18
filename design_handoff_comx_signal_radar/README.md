# Handoff: ComX — "Signal · Radar" redesign (iOS + Apple Watch)

## Overview
Visual redesign of ComX Rider (repo `xavierkain-apps/soarx-voice`, branch `comx`). Every feature stays the same: join by channel code, rider compass (distance + bearing), voice, quick messages, SOS, and the Apple Watch companion. What changes is the look and the layout of the screens.

Direction "2b Signal · Radar" in short:
- Dark teal-black background. State is shown by colour: **teal** = normal or listening, **yellow** = someone is speaking, **red** = SOS.
- On the phone, the radar fills the screen and riders sit in a bottom sheet. Talk and SOS are always at the bottom, under the thumb.
- The type is condensed and uppercase so it reads at a glance (Barlow Condensed).

## About the design files
`comx-2b-signal-radar.html` is a **design reference built in HTML**: static mockups with inline styles. It is not production code. Rebuild these screens in the existing stack:
- Phone: React Native (`src/screens`, `src/components`, `src/theme.ts`)
- Watch: SwiftUI (`ios/SoarXVoiceWatch/Views.swift`)

Keep all existing logic, contexts and protocol unchanged (AgoraContext, RideContext, WatchContext, AppModel). This is a UI-layer change only.

The rider names, distances and channels in the mockups are sample data.

## Fidelity
**High-fidelity** for colours, typography, hierarchy and layout. Exact pixel positions of the radar blips are illustrative, so keep the existing placement algorithm (`OverviewPage.spread`, square-root distance scaling). The phone mockups are 375×812 pt; the watch mockups are 208×248 pt (≈ 45 mm). Scale them to the real devices, including the Ultra.

## Design tokens

### Colours (add to `src/theme.ts` as a new palette; it replaces dark mode for ComX)
| Token | Hex | Use |
|---|---|---|
| bg | `#071518` | App background (phone + watch) |
| surface | `#0F2327` | Bottom sheet, cards |
| surfaceAlt | `#12282C` | Chips, secondary round buttons, history row highlight |
| ring | `#16343A` | Radar rings |
| outline | `#2A4448` | Ghost button borders, sheet grabber |
| text | `#EAF4F3` | Primary text, "me" arrow |
| textMuted | `#7FA3A6` | Labels, secondary text |
| textDim | `#4E7276` | Ring distance labels |
| teal (primary) | `#2ED3C4` | Rider badges/arrows, Talk, Join, live dot, active ring |
| yellow (speaking) | `#FFD23F` | Speaking rider: badge, highlighted row, history voice dot |
| red (SOS) | `#FF453A` | SOS button outline/text, SOS alert screen, North marker |
| onAccent | `#071518` | Text/icons on teal or yellow fills |

Halo around the speaking badge: `0 0 0 8px rgba(255,210,63,0.2)`.

### Typography
- **Barlow Condensed** (Google Fonts, weights 600/700/800) is used for headings, names, distances and button labels, always UPPERCASE.
- **Barlow** (weights 500/600/700) is used for secondary sentences ("Riding as …", "No GPS", "Voice, 6 s").
- On the watch, either bundle Barlow Condensed or use `.system(.., design: .default).width(.condensed)` (watchOS 10+), which is very close.

| Role | Font | Size / weight | Letter-spacing |
|---|---|---|---|
| Channel hero (join) | Barlow Condensed | 40 / 800, line-height 1 | 0 |
| Channel title (live) | Barlow Condensed | 24 / 800 | 0 |
| Overline ("CHANNEL", "● 4 RIDERS") | Barlow Condensed | 12–13 / 600 | 2–3 px |
| Rider name (sheet row) | Barlow Condensed | 20 / 800 | 0 |
| Distance (sheet row) | Barlow Condensed | 22 / 800 | 0 |
| Primary button label | Barlow Condensed | 24–26 / 800 | 1–2 px |
| Badge initials | Barlow Condensed | 17 / 800 (phone), 15 / 800 (watch) | 0 |
| Secondary text | Barlow | 13–15 / 600 | 0 |

### Radii and sizes
- Pills and buttons are fully rounded (radius = height / 2).
- Bottom sheet: top radius 28. Highlighted row: radius 14.
- Primary buttons are 68–72 pt tall. Round side buttons are 68 × 68.
- Radar badges are 44 pt on the phone and 34 pt on the watch.
- "Me" arrow: 20 × 22 pt on the phone, 14 × 16 on the watch.
- Arrow shape (all arrows): `polygon(50% 0, 100% 100%, 50% 75%, 0 100%)`, the same as SF Symbol `location.north.fill`. Use that symbol on watchOS, or a small SVG/Path on React Native.

## Screens

### Phone 1: Join (replaces `HomeScreen.tsx`)
From top to bottom on `bg`:
1. **Top bar** (padding 16/24): "COMX" (Barlow Condensed 16/700, spacing 3) on the left, "Settings" (Barlow 14/600, textMuted) on the right, which opens Settings.
2. **Radar hero** (height ≈ 400): three concentric rings centred, 330/230/130 pt in diameter. The outer two use 2 pt `ring`; the inner one uses 2 pt **teal**. In the centre:
   - "CHANNEL" (12/600, spacing 3, teal)
   - "TARIFA" (40/800, text)
   - "01" (40/800, teal)
   
   Split the channel code at the last "-" so the suffix shows in teal. Tapping the code edits it (inline text input, uppercase, max 30 characters, same validation as `isValidChannelName`).
3. **Favourites row**, centred, gap 10: pills in `surfaceAlt` (15/700, spacing 1, padding 8/14). They come from `@soarx_favorite_channels`. The last pill is a ghost "EDIT" (1.5 pt `outline`, textMuted), which opens favourite management, random channel and save/unsave.
4. Flexible spacer.
5. "Riding as **Xavier Kain**" (14/600, textMuted with the name in text), centred. Tapping it edits the pilot name.
6. **JOIN** button: full width minus 20 pt margins, 72 tall, teal fill, label 26/800 spacing 2 in `onAccent`, 36 pt bottom margin. It is disabled (opacity 0.35) when `canJoin` is false, and the label reads "CONNECTING…" while joining.

### Phone 2: Live channel (replaces `VoiceScreen.tsx`, `PilotList`, `MuteButton` layout)
Layers:
1. **Full-screen radar** behind everything, centred at about y = 260:
   - Rings of 400/260/120 pt, 2 pt `ring`.
   - The "me" arrow is at the centre, in text colour, rotated to the user's heading.
   - Ring labels such as "500 M" (12/600, textDim) sit at the bottom right of a ring.
   - Each rider is a 44 pt circular badge with their initials, filled teal, or yellow with a halo when speaking. Stale riders are at 40 % opacity. Riders in SOS are red and 6 pt bigger.
   - Use the existing radar maths from the watch `OverviewPage` (sqrt scale + spread).
2. **Overlay, top left** (left 20, below the status bar):
   - Channel name (24/800)
   - "● N RIDERS" (13/600, spacing 2, teal); turns amber "RECONNECTING…" or red "CONNECTION LOST" with `connectionState`
   
   **Top right**: "N ↑" (13/700, red), which shows the arrow mode (north up / compass / course).
3. **Bottom sheet** (`surface`, top radius 28, padding 10/18/34): a 40 × 5 grabber. The resting height is about 370 pt. Dragging up gives a full list; dragging down collapses to just the controls. Contents:
   - **Rider rows** (padding 10/12, gap 14): arrow 20 × 22 rotated to the bearing (teal), name (20/800), distance (22/800) on the right.
     - The speaking rider's row has a yellow fill, radius 14, with `onAccent` text and arrow.
     - Riders with no position show a 20 pt hollow circle, "No GPS" and 45 % opacity.
     - SOS riders get a red fill row.
     - Sort order: keep `buildRiderViews` (SOS first, then nearest).
   - **Control row** (gap 8) pinned to the bottom of the sheet:
     - **SOS**: 68 pt circle, 2 pt red outline, red label. Long press 1 s sends SOS (unchanged behaviour); while active it becomes a red fill reading "CANCEL".
     - **HOLD TO TALK**: flexible width, 68 tall, teal fill. When muted it shows "TAP TO TALK" in teal fill; when live it shows "LIVE · TAP TO MUTE" in yellow fill. In watch mode it is replaced by a `surfaceAlt` pill reading "WATCH MODE · TALK ON YOUR WATCH".
     - **MSG**: 68 pt circle in `surfaceAlt`, which opens a sheet with the `QUICK_MESSAGES` as large pills, plus Speaker toggle, Video pause/resume and Leave group (red text, with a confirm prompt).
4. **Banners** (inactivity warning, call interruption, location denied): a full-width pill under the top overlay with an amber fill, `onAccent` text and a "STAY" action.

### Watch: three main pages (restyles `Views.swift`, navigation unchanged)
The crown, paging and Action button mapping stay exactly as they are today. Background is `bg` (`#071518`), or pure black `#000` if you prefer it for the always-on display.

1. **Radar / overview** (`OverviewPage`):
   - Rings use a 3 pt `ring` stroke (outer) and 2 pt (inner).
   - The "me" arrow is white at the centre.
   - Badges are 34 pt, teal (or yellow when speaking, red for SOS), with initials in `onAccent` 15/800. The distance sits under each badge (12/700, text), without the black capsule.
2. **Talk** (`CompassPage(talk: .big)`):
   - Overline "TARIFA-01 · GROUP" (12/700, spacing 2, textMuted).
   - A 150 pt teal circle reading "TALK" (36/800), with the sub-label "Action button" (Barlow 12/600).
   - While recording, the circle turns red and reads "SEND 12" (seconds left). The overline then shows the recipient ("TO GROUP", or the name in yellow); the crown cycles recipients as today.
3. **History** (`HistoryView`):
   - Overline "HISTORY".
   - Rows have a 26 pt marker: a filled yellow dot for a voice clip (tap to replay) or a 2 pt teal ring for text. The title is "NAME · HH:MM" (14/700 condensed) and the summary sits under it (Barlow 13/600; textMuted for voice).
   - The newest voice row gets a `surfaceAlt` background with radius 12.

Other watch screens use the same tokens:
- **Rider page**: name 26/800, teal arrow, distance 40/800.
- **Messages**: `surfaceAlt` pills plus a red "HOLD · SOS" pill (keep the 1.2 s long press and the confirmation step).
- **SOS alert**: full-screen red with a white arrow and the distance.
- **Speaking banner**: yellow fill with `onAccent` text.

## Interactions and behaviour (unchanged logic, new presentation)
- Speaking state comes from Agora volume indication. The yellow highlight should cross-fade over about 150 ms.
- Arrow rotation eases out over 300 ms, matching the existing `DirectionArrow` animation.
- Bottom sheet detents: collapsed (controls only), medium (about 370 pt), large (90 % of the screen).
- SOS keeps its long press plus haptic: 1 s on the phone, and 1.2 s plus confirmation on the watch.
- Haptics and sounds are unchanged (`useMute`, `HapticManager`).

## Files
- `comx-2b-signal-radar.html` contains the static design reference: phone Join, phone Live, and the watch Radar, Talk and History pages. Open it in a browser.
- Codebase files to change:
  - `src/theme.ts`
  - `src/screens/HomeScreen.tsx`
  - `src/screens/VoiceScreen.tsx`
  - `src/components/PilotList.tsx` (becomes the sheet rows)
  - `src/components/MuteButton.tsx` (becomes the Talk pill)
  - `src/components/RideBar.tsx` (becomes the MSG sheet plus SOS)
  - `src/components/ChannelBadge.tsx`
  - `ios/SoarXVoiceWatch/Views.swift`
  - A new radar component on React Native that ports `OverviewPage` from Swift.
- Fonts: add Barlow and Barlow Condensed (OFL licence, Google Fonts) to the RN project (`react-native.config.js` assets) and, optionally, to the watch target.
