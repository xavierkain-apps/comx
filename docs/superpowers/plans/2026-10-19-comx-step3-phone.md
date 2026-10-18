# ComX step 3: phone "Signal · Radar" and voice memos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The ComX phone app (iOS and Android) gets the "Signal · Radar" look (Join screen, full-screen radar with a three-detent bottom sheet, MSG sheet) and voice memos recorded on the phone, sent to the group or to one rider, played on arrival, forwarded to the watch and kept in a history.

**Architecture:** Pure, unit-tested TypeScript modules hold the logic (`src/radar/` radar maths ported from the watch `OverviewPage` and the sheet detents, `src/memo/memo.ts`, `src/ride/history.ts`, group clips in `src/ride/voiceClips.ts`). A new `MemoContext` owns every voice memo (phone MEMO button, watch clips, data-stream clips, playback, history, demo echo); `WatchContext` shrinks to the watch link, mic policy, state, events and remote-speech clips; `AgoraContext` gains a "memo capture" switch that mutes the live stream while Agora's file recorder captures the phone mic. Screens are rebuilt from small components in `src/components/signal/` with React Native core only (Animated, PanResponder, View borders): no new npm dependency.

**Tech Stack:** React Native 0.84 (CLI), TypeScript, `react-native-agora` 4.6.2 (`startAudioRecording` with `AudioFileRecordingMic`, `startAudioMixing` loopback), `react-native-sound` (playback outside Agora), `react-native-safe-area-context` (already a dependency), Barlow / Barlow Condensed (OFL) bundled as TTF, Jest, Xcode iPhone + Apple Watch simulators, Android emulators `ComX_Phone34` / `Medium_Phone_API_36.1`.

**Spec:** `docs/superpowers/specs/2026-10-18-comx-standalone-signal-radar-design.md` ("Visual system", "Step 3: phone"), `design_handoff_comx_signal_radar/README.md` ("Phone 1: Join", "Phone 2: Live channel") and `design_handoff_comx_signal_radar/comx-2b-signal-radar.html` (open it in a browser; the phone mockups are 375 × 812 pt). Protocol: `docs/watch-companion.md`.

**Repository rules:** work on branch `phone-signal-radar` from `main` of `xavierkain-apps/comx`; open a pull request to `main`, never push to `main` (the ComX server session reviews and merges); commit messages and the PR description carry no AI attribution of any kind. This plan runs on the owner's Mac: Gradle and Xcode builds are allowed here (never on the Linux server).

**Kept unchanged (do not touch their behaviour):** BLE button and HID (`useBluetoothHID`), mute feedback sounds and haptics (`useMute`, `HapticManager`), inactivity auto-disconnect and its sound, join/leave voice announcements (TTS), the watch bridge contract except the two Android methods added in Task 11, Garmin "talk via phone", Settings screen content, quick messages and SOS protocol, demo mode.

---

## Decisions for the owner

Each has a recommendation that this plan implements. Change the plan before execution if you decide otherwise.

1. **No new dependency (no `react-native-svg`).** The arrow (`polygon(50% 0, 100% 100%, 50% 75%, 0 100%)`) is drawn with two border triangles: a full triangle in the arrow colour, and a flat triangle in the colour behind it cut out of the base (the 75 % notch). Sharp at any size, any colour, no image assets, rotates with `Animated` on the native driver. Its only constraint is that it needs the background colour (passed as `backColor`), which is always known (radar `bg`, sheet `surface`, yellow or red row). Alternative: a tinted PNG (needs @2x/@3x artwork) or `react-native-svg` (native dependency, pod install, new CI surface). **Recommendation: border triangles.**
2. **Phone memo recording = Agora's own file recorder** (`startAudioRecording` with `AudioFileRecordingType.AudioFileRecordingMic`) while the live stream is muted (`muteLocalAudioStream(true)`; Agora documents that this "does not disable the audio capturing device"). Agora keeps the microphone, so no second recorder fights it for the audio session. Fallback B if a device records silence while muted: stop publishing the mic track instead (`updateChannelMediaOptions({publishMicrophoneTrack: false})`, code in Task 19 step 6). Fallback C (not planned, needs your go-ahead): a native recorder in `WatchBridge` (AVAudioRecorder / MediaRecorder) after `enableLocalAudio(false)`. **Recommendation: Agora recorder, verify on a real iPhone before merging.**
3. **Received memos in watch mode play on the watch only**, not on the phone sitting in the pouch (outside watch mode they play on the phone, and are forwarded to any active Apple Watch / Wear OS watch). **Recommendation: as written.**
4. **History lives for the app's run** (spec: "kept for the app's run like on the watch"): it is no longer cleared when you leave a channel. Memo audio is kept in memory as base64 (at most 10 clips, about 60 KB each), so no file has to survive the bridge, which deletes forwarded files. **Recommendation: as written.**
5. **Older riders are not detected.** A rider on an older ComX ignores group memos (`to: 0` is not their uid) and still sends their watch group clips into the live audio, which new phones hear live. Detecting them would need a version field in the `name` message. **Recommendation: no detection; everyone installs the new build (TestFlight / APK).**
6. **Small distance labels under the phone radar badges** ("180", "1.4K", the watch's `Format.short`), which the handoff mockup does not show on the phone. They make the radar readable without opening the sheet. **Recommendation: show them** (delete one `<Text>` in `RadarView` to remove).
7. **"● N RIDERS" counts everyone in the channel including you** (like the old `PilotList` badge), so it never reads "0 RIDERS". **Recommendation: as written.**
8. **Tapping a rider row while recording sends the memo to that rider at once** (spec: "tapping a rider row while recording sends to that rider only"); MEMO again sends to the group; at 30 s the memo goes to the group by itself. **Recommendation: as written.**
9. **Arrow mode (top right):** the phone compass is never used (pouch), so the toggle is "N ↑" (north up, default) and "COG ↑" (your course up, from GPS). **Recommendation: as written.**
10. **Control row has four buttons** (SOS · TALK · MEMO · MSG, the spec) while the handoff mockup has three, so TALK is narrower: its label is two lines ("TALK" / "TAP TO TALK", "LIVE" / "TAP TO MUTE"). **Recommendation: as written.**

---

## Files

| File | Create / Modify | Responsibility |
|---|---|---|
| `src/theme.ts` | Modify | `signal` palette, `condensed()` / `plain()` type helpers, legacy `colors` mapped onto the Signal palette (Settings keeps working), no light mode |
| `src/contexts/ThemeContext.tsx` | Modify | Single palette, no toggle |
| `src/radar/radar.ts` | Create | Port of the watch `OverviewPage` maths: `point`, `spread`, `niceDistance`, `layoutRadar`, `shortDistance`, `ringDistance`, `initials`, arrow heading and rotation helpers |
| `src/radar/sheet.ts` | Create | Bottom-sheet detents and settling |
| `src/radar/__tests__/radar.test.ts`, `sheet.test.ts` | Create | Shared radar cases (to be reused by the Wear OS port), detents |
| `src/utils/channelGenerator.ts` (+ test) | Modify | `splitChannelCode` (suffix after the last "-") |
| `src/ride/voiceClips.ts` (+ test) | Modify | `GROUP_UID = 0`, `isClipForMe` |
| `src/ride/protocol.ts` (+ test) | Modify | `PROTOCOL_VERSION = 2` |
| `src/ride/history.ts` (+ test) | Create | History trimming (30 items / 10 clips, like `History.swift`) |
| `src/memo/memo.ts` (+ `src/memo/__tests__/memo.test.ts`) | Create | Memo limits, countdown, recipient, summary, clip id, history title |
| `src/ride/micPolicy.ts` (+ test) | Modify | Drop `injecting` (watch clips are no longer mixed into the channel) |
| `assets/fonts/*.ttf`, `assets/fonts/OFL.txt` | Create | Barlow 500/600/700, Barlow Condensed 600/700/800 |
| `scripts/add-phone-fonts.rb` | Create | Adds the fonts to the iOS target and `UIAppFonts` (xcodeproj gem; never sed the pbxproj) |
| `android/app/build.gradle` | Modify | `assets/` as an extra Android assets dir (fonts) |
| `ios/SoarXVoice/Info.plist`, `ios/SoarXVoice.xcodeproj/project.pbxproj` | Modify (by script) | Font resources |
| `android/app/src/main/java/com/soarxvoice/watch/WatchBridgeModule.kt` | Modify | `readClipBase64`, `writeClip` (exist on iOS only today) |
| `src/services/WatchBridge.ts` | Modify | Doc comment only |
| `src/contexts/AgoraContext.tsx` | Modify | `setMemoCapture` / `isMemoCapture` |
| `src/contexts/WatchContext.tsx` | Modify (rewrite) | Watch link, mic policy, state, events, remote-speech clips; memo code moved out; `voiceWatch` exposed |
| `src/contexts/RideContext.tsx` | Modify | History via `addToHistory`, `clip` on messages, kept for the app run |
| `src/contexts/MemoContext.tsx` | Create | Phone recording, sending, receiving, playback, forwarding, demo echo |
| `src/components/signal/Arrow.tsx` | Create | Dependency-free arrow, eased rotation |
| `src/components/signal/RadarView.tsx` | Create | Rings, N mark, me arrow, rider badges |
| `src/components/signal/RiderRow.tsx` | Create | Sheet row (arrow, name, distance; speaking / SOS / No GPS) |
| `src/components/signal/Banner.tsx` | Create | Amber (or red) pill with an optional action |
| `src/components/signal/ControlRow.tsx` | Create | SOS · TALK · MEMO · MSG |
| `src/components/signal/BottomSheet.tsx` | Create | Three detents, Animated + PanResponder |
| `src/components/signal/MsgSheet.tsx` | Create | Quick messages, history with replay, speaker, video, leave |
| `src/screens/JoinScreen.tsx` | Create | Replaces `HomeScreen.tsx` |
| `src/screens/LiveScreen.tsx` | Create | Replaces `VoiceScreen.tsx` |
| `src/screens/HomeScreen.tsx`, `VoiceScreen.tsx`, `src/components/PilotList.tsx`, `MuteButton.tsx`, `RideBar.tsx`, `ChannelBadge.tsx` | Delete | Replaced |
| `App.tsx` | Modify | Safe area, `MemoProvider`, new screens |
| `jest.setup.js` | Modify | Safe-area mock, `AudioFileRecordingMic` in the Agora mock |
| `docs/watch-companion.md`, `CLAUDE.md` | Modify | Group memos, protocol v2, phone memos, test count |

---

### Task 1: Branch and Signal theme tokens

**Files:**
- Modify: `src/theme.ts`

- [ ] **Step 1: Create the branch (the plan is its first commit)**

```bash
cd /Users/xavier/VSCode3/ComX
git fetch origin && git switch main && git pull --ff-only
git switch -c phone-signal-radar
git add docs/superpowers/plans/2026-10-19-comx-step3-phone.md
git commit -m "docs: step 3 phone implementation plan"
```

- [ ] **Step 2: Replace `src/theme.ts`**

```ts
// ComX "Signal · Radar" design system (design_handoff_comx_signal_radar).
// One dark palette, no light mode. Teal = normal or listening, yellow =
// someone speaking, red = SOS.

import {TextStyle} from 'react-native';

type StatusBarStyle = 'light-content' | 'dark-content';

export const signal = {
  bg: '#071518',
  surface: '#0F2327',
  surfaceAlt: '#12282C',
  ring: '#16343A',
  outline: '#2A4448',
  text: '#EAF4F3',
  textMuted: '#7FA3A6',
  textDim: '#4E7276',
  teal: '#2ED3C4',
  yellow: '#FFD23F',
  /** Halo around a speaking badge. */
  yellowHalo: 'rgba(255, 210, 63, 0.2)',
  red: '#FF453A',
  /** Warnings (reconnecting, banners). Same as the watch Theme.amber. */
  amber: '#FFB020',
  /** Text and icons on a teal or yellow fill. */
  onAccent: '#071518',
} as const;

// Legacy token names used by SettingsScreen, mapped onto the Signal palette.
// No `as const`: values widen to string.
const darkColors = {
  primary: signal.teal as string,
  primaryDark: '#22A89C',
  primaryLight: 'rgba(46, 211, 196, 0.12)',
  primaryBorder: 'rgba(46, 211, 196, 0.25)',
  primaryGlow: 'rgba(46, 211, 196, 0.40)',
  bg: signal.bg as string,
  bgCard: signal.surface as string,
  bgCardActive: signal.surfaceAlt as string,
  bgInput: signal.surfaceAlt as string,
  green: signal.teal as string,
  greenLight: 'rgba(46, 211, 196, 0.15)',
  red: signal.red as string,
  redLight: 'rgba(255, 69, 58, 0.12)',
  redGlow: 'rgba(255, 69, 58, 0.40)',
  amber: signal.amber as string,
  white: signal.text as string,
  text: signal.text as string,
  textSecondary: signal.textMuted as string,
  textMuted: signal.textMuted as string,
  textDim: signal.textDim as string,
  cardBorder: 'rgba(234, 244, 243, 0.06)',
  statusBar: 'light-content' as StatusBarStyle,
};

export type ThemeColors = typeof darkColors;
export type ThemeMode = 'dark' | 'light';

/** Kept until HomeScreen is gone (Task 18); ComX has one palette. */
export function getColors(_mode: ThemeMode): ThemeColors {
  return darkColors;
}

export const colors = darkColors;

// Bundled from assets/fonts (OFL). The family name is the file name, which is
// also the PostScript name iOS looks up. Never add fontWeight next to these:
// the weight is part of the family, and Android would fake a bold.
export const fontFamily = {
  condensed600: 'BarlowCondensed-SemiBold',
  condensed700: 'BarlowCondensed-Bold',
  condensed800: 'BarlowCondensed-ExtraBold',
  plain500: 'Barlow-Medium',
  plain600: 'Barlow-SemiBold',
  plain700: 'Barlow-Bold',
} as const;

/** Headings, names, distances, button labels: Barlow Condensed, uppercase. */
export function condensed(size: number, weight: 600 | 700 | 800 = 800, letterSpacing = 0): TextStyle {
  return {
    fontFamily: fontFamily[`condensed${weight}` as const],
    fontSize: size,
    letterSpacing,
    textTransform: 'uppercase',
  };
}

/** Secondary sentences ("Riding as …", "No GPS", "Voice, 6 s"): Barlow. */
export function plain(size: number, weight: 500 | 600 | 700 = 600): TextStyle {
  return {fontFamily: fontFamily[`plain${weight}` as const], fontSize: size};
}

export const fonts = {
  xs: 11,
  sm: 13,
  body: 15,
  input: 16,
  button: 17,
  title: 24,
  heading: 20,
  logo: 38,
  label: 12,
  small: 11,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
} as const;
```

(The old `navy` / `cyan` aliases had no users; `grep -rn "navy\|cyan\b" src App.tsx` printed nothing.)

- [ ] **Step 3: Type-check and test**

Run: `npx tsc --noEmit && npx jest --maxWorkers=1 2>&1 | tail -4`
Expected: no tsc output; `Tests: 54 passed, 54 total`.

- [ ] **Step 4: Commit**

```bash
git add src/theme.ts
git commit -m "feat(phone): Signal palette and Barlow type helpers"
```

---

### Task 2: Radar maths (port of the watch OverviewPage)

**Files:**
- Create: `src/radar/radar.ts`
- Test: `src/radar/__tests__/radar.test.ts`

The Swift reference is `ios/SoarXVoiceWatch/Views.swift` (`OverviewPage.point`, `spread`, `niceDistance`, `RiderBadge.initials`) and `ios/SoarXVoiceWatch/Protocol.swift` (`Format.distance`, `Format.short`). The test cases below are the shared cases: the Wear OS port (step 4) must pass the same numbers.

- [ ] **Step 1: Write the failing test**

`src/radar/__tests__/radar.test.ts`:

```ts
import {
  MIN_FARTHEST_M,
  arrowHeading,
  initials,
  layoutRadar,
  nextRotation,
  niceDistance,
  point,
  ringDistance,
  shortDistance,
  spread,
} from '../radar';

const c = {x: 150, y: 150};
const dist = (a: {x: number; y: number}, b: {x: number; y: number}) => Math.hypot(a.x - b.x, a.y - b.y);

describe('point', () => {
  it('measures angles clockwise from the top of the screen', () => {
    expect(point({x: 100, y: 100}, 50, 0, 1)).toEqual({x: 100, y: 50});
    const east = point({x: 100, y: 100}, 50, 90, 1);
    expect(east.x).toBeCloseTo(150);
    expect(east.y).toBeCloseTo(100);
    const half = point({x: 100, y: 100}, 50, 180, 0.5);
    expect(half.x).toBeCloseTo(100);
    expect(half.y).toBeCloseTo(125);
  });
});

describe('niceDistance', () => {
  it('rounds down to 1, 2 or 5 times a power of ten', () => {
    expect(niceDistance(0)).toBe(0);
    expect(niceDistance(-3)).toBe(0);
    expect(niceDistance(7)).toBe(5);
    expect(niceDistance(25)).toBe(20);
    expect(niceDistance(450)).toBe(200);
    expect(niceDistance(1000)).toBe(1000);
    expect(niceDistance(1999)).toBe(1000);
    expect(niceDistance(2000)).toBe(2000);
    expect(niceDistance(4999)).toBe(2000);
    expect(niceDistance(5000)).toBe(5000);
  });
});

describe('shortDistance and ringDistance', () => {
  it('formats badge distances without a unit, like Format.short', () => {
    expect(shortDistance(null)).toBe('--');
    expect(shortDistance(NaN)).toBe('--');
    expect(shortDistance(180.4)).toBe('180');
    expect(shortDistance(999.6)).toBe('1000');
    expect(shortDistance(1400)).toBe('1.4K');
    expect(shortDistance(12345)).toBe('12K');
  });

  it('formats ring labels in uppercase, like Format.distance', () => {
    expect(ringDistance(500)).toBe('500 M');
    expect(ringDistance(1400)).toBe('1.4 KM');
    expect(ringDistance(20000)).toBe('20 KM');
  });
});

describe('layoutRadar', () => {
  const riders = [
    {uid: 1, dist: 900, brg: 0},
    {uid: 2, dist: 225, brg: 180},
    {uid: 3, dist: null, brg: null},
  ];

  it('puts the farthest rider on the outer ring and scales by the square root', () => {
    const l = layoutRadar(riders, 300, 300, 0, 44);
    expect(l.centre).toEqual(c);
    expect(l.radius).toBe(126); // 300 / 2 - 44 / 2 - 2
    expect(l.farthest).toBe(900);
    const a = l.spots.find(s => s.uid === 1)!;
    const b = l.spots.find(s => s.uid === 2)!;
    expect(a.x).toBeCloseTo(150);
    expect(a.y).toBeCloseTo(24);
    expect(b.x).toBeCloseTo(150);
    expect(b.y).toBeCloseTo(213); // sqrt(225 / 900) = 0.5 of the radius, south
    expect(l.unplaced).toEqual([3]);
  });

  it('draws a round inner ring at the square-root radius', () => {
    const l = layoutRadar(riders, 300, 300, 0, 44);
    expect(l.inner).toBe(200);
    expect(l.innerRadius).toBeCloseTo(59.4, 1);
    expect(l.north.x).toBeCloseTo(150);
    expect(l.north.y).toBeCloseTo(14);
  });

  it('turns everything by the heading', () => {
    const l = layoutRadar([{uid: 1, dist: 900, brg: 90}], 300, 300, 90, 44);
    expect(l.spots[0].x).toBeCloseTo(150);
    expect(l.spots[0].y).toBeCloseTo(24);
    expect(l.north.x).toBeCloseTo(14);
    expect(l.north.y).toBeCloseTo(150);
  });

  it('never lets a lone near rider sit on the edge', () => {
    const l = layoutRadar([{uid: 1, dist: 10, brg: 90}], 300, 300, 0, 44);
    expect(l.farthest).toBe(MIN_FARTHEST_M);
    expect(l.spots[0].x).toBeCloseTo(150 + 126 * Math.sqrt(10 / 50));
    expect(l.inner).toBe(20);
    expect(l.innerRadius).toBeCloseTo(126 * Math.sqrt(20 / 50));
  });

  it('uses the 50 m floor when nobody has a position', () => {
    const l = layoutRadar([{uid: 3, dist: null, brg: null}], 300, 300, 0, 44);
    expect(l.farthest).toBe(50);
    expect(l.inner).toBe(20);
    expect(l.innerRadius).toBeCloseTo(126 * Math.sqrt(20 / 50));
    expect(l.spots).toEqual([]);
    expect(l.unplaced).toEqual([3]);
  });
});

describe('spread', () => {
  it('pushes two riders on the same spot one badge + 10 apart, inside the ring', () => {
    const out = spread([{x: 150, y: 50}, {x: 150, y: 50}], c, 126, 44);
    expect(dist(out[0], out[1])).toBeGreaterThanOrEqual(53.99);
    out.forEach(p => expect(dist(p, c)).toBeLessThanOrEqual(126 + 1e-9));
  });

  it('pushes riders on the same bearing sideways, not only along the ray', () => {
    const out = spread([{x: 150, y: 60}, {x: 150, y: 80}], c, 126, 44);
    expect(out[0].x).toBeLessThan(150);
    expect(out[1].x).toBeGreaterThan(150);
    expect(dist(out[0], out[1])).toBeGreaterThanOrEqual(53.99);
  });

  it('leaves riders far apart where they are', () => {
    const pts = [{x: 150, y: 30}, {x: 150, y: 270}];
    expect(spread(pts, c, 126, 44)).toEqual(pts);
  });

  it('brings a badge outside the ring back onto it', () => {
    const out = spread([{x: 150, y: 0}], c, 126, 44);
    expect(out[0].x).toBeCloseTo(150);
    expect(out[0].y).toBeCloseTo(24);
  });

  it('does not change its input', () => {
    const pts = [{x: 150, y: 50}, {x: 150, y: 50}];
    spread(pts, c, 126, 44);
    expect(pts).toEqual([{x: 150, y: 50}, {x: 150, y: 50}]);
  });
});

describe('initials', () => {
  it('takes the first letter of the first two words, ignoring parentheses', () => {
    expect(initials('Xavier Kain')).toBe('XK');
    expect(initials('Lea (demo)')).toBe('L');
    expect(initials('jean-luc picard')).toBe('JL');
    expect(initials('léa_martin')).toBe('LM');
    expect(initials('')).toBe('?');
    expect(initials('(demo)')).toBe('?');
  });
});

describe('arrow helpers', () => {
  it('uses north up, or my course in course mode when known', () => {
    expect(arrowHeading('north', 90)).toBe(0);
    expect(arrowHeading('course', 90)).toBe(90);
    expect(arrowHeading('course', null)).toBe(0);
    expect(arrowHeading('course', undefined)).toBe(0);
  });

  it('turns the shortest way', () => {
    expect(nextRotation(350, 10)).toBe(370);
    expect(nextRotation(10, 350)).toBe(-10);
    expect(nextRotation(0, 90)).toBe(90);
    expect(nextRotation(720, 0)).toBe(720);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/radar --maxWorkers=1`
Expected: FAIL, `Cannot find module '../radar' from 'src/radar/__tests__/radar.test.ts'`.

- [ ] **Step 3: Implement `src/radar/radar.ts`**

```ts
// Radar placement, ported as is from the Apple Watch OverviewPage
// (ios/SoarXVoiceWatch/Views.swift): me in the centre, the top of the screen
// is the heading the arrows use, the farthest rider on the outer ring.
// Distance from the centre is the square root of the distance, so near riders
// do not sit on me; badges that would overlap are pushed apart and kept inside
// the ring. The Wear OS port must pass the cases in __tests__/radar.test.ts.

export interface Point {
  x: number;
  y: number;
}

/** Smallest "farthest" distance, so a lone rider at 5 m is not on the edge. */
export const MIN_FARTHEST_M = 50;

/** `angle` in degrees clockwise from the top of the screen. */
export function point(c: Point, radius: number, angle: number, fraction: number): Point {
  const a = (angle * Math.PI) / 180;
  const r = radius * fraction;
  return {x: c.x + r * Math.sin(a), y: c.y - r * Math.cos(a)};
}

/**
 * Pushes apart badges closer than a badge (and its distance label), a few
 * relaxation passes, keeping them inside the outer ring. Riders on the same
 * bearing are also pushed sideways, or they would only slide along the ray
 * and out of the ring. Returns new points; the input is not changed.
 */
export function spread(points: Point[], c: Point, radius: number, badge: number): Point[] {
  const p = points.map(q => ({x: q.x, y: q.y}));
  const minGap = badge + 10;
  for (let pass = 0; pass < 20; pass++) {
    let moved = false;
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        const dx = p[j].x - p[i].x;
        const dy = p[j].y - p[i].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= minGap) continue;
        // Away from each other, plus sideways (perpendicular to the ray).
        const mx = (p[i].x + p[j].x) / 2 - c.x;
        const my = (p[i].y + p[j].y) / 2 - c.y;
        const m = Math.max(Math.sqrt(mx * mx + my * my), 0.01);
        let ux = d > 0.01 ? dx / d : 0;
        let uy = d > 0.01 ? dy / d : 1;
        ux += (-my / m) * 0.7;
        uy += (mx / m) * 0.7;
        const u = Math.max(Math.sqrt(ux * ux + uy * uy), 0.01);
        const push = (minGap - d) / 2;
        p[i].x -= (ux / u) * push;
        p[i].y -= (uy / u) * push;
        p[j].x += (ux / u) * push;
        p[j].y += (uy / u) * push;
        moved = true;
      }
    }
    for (let i = 0; i < p.length; i++) {
      const dx = p[i].x - c.x;
      const dy = p[i].y - c.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > radius) p[i] = {x: c.x + (dx / d) * radius, y: c.y + (dy / d) * radius};
    }
    if (!moved) break;
  }
  return p;
}

/** A round ring distance: 1, 2 or 5 times a power of ten, not above `d`. */
export function niceDistance(d: number): number {
  if (!(d > 0)) return 0;
  const base = Math.pow(10, Math.floor(Math.log10(d)));
  for (const m of [5, 2, 1]) {
    if (m * base <= d) return m * base;
  }
  return base;
}

/** Under a radar badge, no unit: "180", "1.4K", "12K", "--" (Format.short). */
export function shortDistance(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return '--';
  if (m < 1000) return `${Math.round(m)}`;
  if (m < 10_000) return `${(m / 1000).toFixed(1)}K`;
  return `${Math.round(m / 1000)}K`;
}

/** Ring label: "500 M", "1.4 KM", "20 KM" (Format.distance, uppercase). */
export function ringDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} M`;
  if (m < 10_000) return `${(m / 1000).toFixed(1)} KM`;
  return `${Math.round(m / 1000)} KM`;
}

/**
 * "Xavier Kain" gives "XK", "Lea (demo)" gives "L": the first letter of the
 * first two words, ignoring anything in parentheses (RiderBadge.initials).
 */
export function initials(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, '')
    .split(/[ \-_]/)
    .filter(w => w.length > 0);
  const letters = words.slice(0, 2).map(w => Array.from(w)[0].toUpperCase());
  return letters.length === 0 ? '?' : letters.join('');
}

export interface RadarRider {
  uid: number;
  dist: number | null;
  brg: number | null;
}

export interface RadarLayout {
  centre: Point;
  /** Outer ring radius: the farthest rider's distance. */
  radius: number;
  farthest: number;
  /** Round distance of the inner ring. */
  inner: number;
  /** Inner ring radius, null when the round distance is not inside. */
  innerRadius: number | null;
  spots: {uid: number; x: number; y: number}[];
  /** Riders without a distance or bearing (shown in the list only). */
  unplaced: number[];
  /** Where the red "N" goes, just outside the outer ring. */
  north: Point;
}

/**
 * Lays out every rider in a `width` × `height` box. `heading` is the true
 * bearing at the top of the screen (0 = north up). `badge` is the badge
 * diameter (44 on the phone, 34 on the watch).
 */
export function layoutRadar(riders: RadarRider[], width: number, height: number, heading: number, badge: number): RadarLayout {
  const placed = riders.filter(r => r.dist !== null && r.brg !== null);
  const unplaced = riders.filter(r => r.dist === null || r.brg === null).map(r => r.uid);
  const farthest = Math.max(Math.max(0, ...placed.map(r => r.dist as number)), MIN_FARTHEST_M);
  const size = Math.min(width, height);
  // The farthest badge sits on the edge ring, inside the box.
  const radius = size / 2 - badge / 2 - 2;
  const centre = {x: width / 2, y: height / 2};
  const inner = niceDistance(farthest / 2);
  const raw = placed.map(r =>
    point(centre, radius, (r.brg as number) - heading, Math.sqrt((r.dist as number) / farthest)),
  );
  const spots = spread(raw, centre, radius, badge).map((p, i) => ({uid: placed[i].uid, x: p.x, y: p.y}));
  return {
    centre,
    radius,
    farthest,
    inner,
    innerRadius: inner < farthest ? radius * Math.sqrt(inner / farthest) : null,
    spots,
    unplaced,
    north: point(centre, radius + 10, -heading, 1),
  };
}

/** North up, or my course up. The phone compass is never used (pouch). */
export type ArrowMode = 'north' | 'course';

/** True bearing at the top of the screen for an arrow mode. */
export function arrowHeading(mode: ArrowMode, cog: number | null | undefined): number {
  return mode === 'course' && typeof cog === 'number' && Number.isFinite(cog) ? cog : 0;
}

/** The rotation to animate to from `current` so the arrow turns the short way. */
export function nextRotation(current: number, target: number): number {
  const delta = ((((target - current) % 360) + 540) % 360) - 180;
  return current + delta;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/radar --maxWorkers=1`
Expected: PASS, `Tests: 17 passed, 17 total`.

- [ ] **Step 5: Commit**

```bash
git add src/radar/radar.ts src/radar/__tests__/radar.test.ts
git commit -m "feat(phone): radar maths ported from the watch OverviewPage"
```

---

### Task 3: Bottom-sheet detents

**Files:**
- Create: `src/radar/sheet.ts`
- Test: `src/radar/__tests__/sheet.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import {CONTROL_HEIGHT, HANDLE_HEIGHT, SHEET_MEDIUM, clampSheet, nextDetent, settleDetent, sheetDetents} from '../sheet';

describe('sheetDetents', () => {
  it('gives controls only, about 370 pt, and 90 % of the screen', () => {
    expect(sheetDetents(812, 34)).toEqual({collapsed: 10 + HANDLE_HEIGHT + CONTROL_HEIGHT + 8 + 34, medium: SHEET_MEDIUM, large: 731});
  });

  it('never lets medium go above large on a short screen', () => {
    expect(sheetDetents(600, 0)).toEqual({collapsed: 111, medium: 370, large: 540});
    expect(sheetDetents(400, 0).large).toBe(370);
  });
});

describe('settling', () => {
  const d = sheetDetents(812, 34); // 145 / 370 / 731

  it('goes to the nearest detent after a slow drag', () => {
    expect(settleDetent(300, 0, d)).toBe(370);
    expect(settleDetent(200, 0.1, d)).toBe(145);
    expect(settleDetent(600, 0, d)).toBe(731);
  });

  it('moves one detent in the direction of a flick', () => {
    expect(settleDetent(300, 1, d)).toBe(145);
    expect(settleDetent(300, -1, d)).toBe(370);
    expect(settleDetent(400, -1, d)).toBe(731);
    expect(settleDetent(731, -1, d)).toBe(731);
    expect(settleDetent(145, 1, d)).toBe(145);
  });

  it('keeps the sheet between collapsed and large', () => {
    expect(clampSheet(1000, d)).toBe(731);
    expect(clampSheet(0, d)).toBe(145);
    expect(clampSheet(500, d)).toBe(500);
  });

  it('cycles detents on a tap of the grabber', () => {
    expect(nextDetent(145, d)).toBe(370);
    expect(nextDetent(370, d)).toBe(731);
    expect(nextDetent(731, d)).toBe(145);
    expect(nextDetent(200, d)).toBe(370);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/radar/__tests__/sheet.test.ts --maxWorkers=1`
Expected: FAIL, `Cannot find module '../sheet'`.

- [ ] **Step 3: Implement `src/radar/sheet.ts`**

```ts
// Detents of the live screen's bottom sheet: controls only, about 370 pt,
// and 90 % of the screen (design handoff, "Bottom sheet").

/** Grabber plus the space around it. */
export const HANDLE_HEIGHT = 25;
/** The SOS · TALK · MEMO · MSG row. */
export const CONTROL_HEIGHT = 68;
export const SHEET_MEDIUM = 370;
/** A release faster than this (px/ms) is a flick. */
const FLICK_VELOCITY = 0.5;

export interface Detents {
  collapsed: number;
  medium: number;
  large: number;
}

/** `bottomPad` is the padding under the control row (home indicator). */
export function sheetDetents(screenHeight: number, bottomPad: number): Detents {
  const collapsed = 10 + HANDLE_HEIGHT + CONTROL_HEIGHT + 8 + bottomPad;
  const large = Math.max(Math.round(screenHeight * 0.9), SHEET_MEDIUM, collapsed);
  const medium = Math.min(Math.max(SHEET_MEDIUM, collapsed + 60), large);
  return {collapsed, medium, large};
}

export function clampSheet(height: number, d: Detents): number {
  return Math.min(d.large, Math.max(d.collapsed, height));
}

function stops(d: Detents): number[] {
  return [d.collapsed, d.medium, d.large];
}

function nearest(height: number, d: Detents): number {
  return stops(d).reduce((best, s) => (Math.abs(s - height) < Math.abs(best - height) ? s : best), d.collapsed);
}

/** Where the sheet rests after a drag. `vy` > 0 is a move down (px/ms). */
export function settleDetent(height: number, vy: number, d: Detents): number {
  if (Math.abs(vy) > FLICK_VELOCITY) {
    if (vy < 0) return stops(d).find(s => s > height + 1) ?? d.large;
    return [...stops(d)].reverse().find(s => s < height - 1) ?? d.collapsed;
  }
  return nearest(height, d);
}

/** A tap on the grabber: collapsed → medium → large → collapsed. */
export function nextDetent(height: number, d: Detents): number {
  const all = stops(d);
  const i = all.indexOf(nearest(height, d));
  return all[(i + 1) % all.length];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/radar --maxWorkers=1`
Expected: PASS, both radar suites green.

- [ ] **Step 5: Commit**

```bash
git add src/radar/sheet.ts src/radar/__tests__/sheet.test.ts
git commit -m "feat(phone): bottom sheet detents"
```

---

### Task 4: Channel code split for the Join hero

**Files:**
- Modify: `src/utils/channelGenerator.ts`
- Test: `src/utils/__tests__/channelGenerator.test.ts`

- [ ] **Step 1: Write the failing test**

Change the import line at the top of `src/utils/__tests__/channelGenerator.test.ts` to:

```ts
import {generateChannelName, isValidChannelName, splitChannelCode} from '../channelGenerator';
```

and append:

```ts
describe('splitChannelCode', () => {
  it('splits at the last "-" so the suffix can be drawn in teal', () => {
    expect(splitChannelCode('TARIFA-01')).toEqual({head: 'TARIFA', tail: '01'});
    expect(splitChannelCode('LEUCATE-NORD-03')).toEqual({head: 'LEUCATE-NORD', tail: '03'});
  });

  it('keeps a code without a usable "-" whole', () => {
    expect(splitChannelCode('ALMANARRE')).toEqual({head: 'ALMANARRE', tail: ''});
    expect(splitChannelCode('-01')).toEqual({head: '-01', tail: ''});
    expect(splitChannelCode('TARIFA-')).toEqual({head: 'TARIFA-', tail: ''});
    expect(splitChannelCode('')).toEqual({head: '', tail: ''});
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/utils/__tests__/channelGenerator.test.ts --maxWorkers=1`
Expected: FAIL, `TypeError: (0 , _channelGenerator.splitChannelCode) is not a function`.

- [ ] **Step 3: Implement**

Append to `src/utils/channelGenerator.ts`:

```ts

/**
 * The Join hero shows "TARIFA" over "01": the code split at its last "-".
 * A code without a "-" between two parts stays whole.
 */
export function splitChannelCode(code: string): {head: string; tail: string} {
  const i = code.lastIndexOf('-');
  if (i <= 0 || i === code.length - 1) return {head: code, tail: ''};
  return {head: code.slice(0, i), tail: code.slice(i + 1)};
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/utils/__tests__/channelGenerator.test.ts --maxWorkers=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/channelGenerator.ts src/utils/__tests__/channelGenerator.test.ts
git commit -m "feat(phone): split the channel code for the join hero"
```

---

### Task 5: Group voice clips (`to: 0`) and protocol v2

**Files:**
- Modify: `src/ride/voiceClips.ts`, `src/ride/protocol.ts:6`
- Test: `src/ride/__tests__/voiceClips.test.ts`, `src/ride/__tests__/protocol.test.ts:92`

- [ ] **Step 1: Write the failing tests**

In `src/ride/__tests__/voiceClips.test.ts`, change the import to:

```ts
import {
  splitClip,
  parseVoiceChunk,
  ClipAssembler,
  CHUNK_CHARS,
  ASSEMBLY_TIMEOUT_MS,
  GROUP_UID,
  isClipForMe,
} from '../voiceClips';
```

and append:

```ts
describe('group clips', () => {
  it('addresses every rider with to: 0 and reassembles like a private clip', () => {
    const chunks = splitClip(clip, 'g1', GROUP_UID, 5000, 'aac');
    expect(chunks).toHaveLength(3);
    expect(chunks.every(c => c.to === 0)).toBe(true);
    // What travels is JSON: parse it back as the receiving phone does
    const parsed = chunks.map(c => parseVoiceChunk(JSON.parse(JSON.stringify(c))));
    expect(parsed.every(c => c !== null && c.to === 0)).toBe(true);
    const a = new ClipAssembler();
    const results = parsed.map((c, i) => a.add(9, c!, i));
    expect(results[0]).toBeNull();
    expect(results[2]).toEqual({id: 'g1', fromUid: 9, base64: clip, durationMs: 5000, ext: 'aac'});
  });

  it('keeps a group clip and a private clip with the same id apart per sender', () => {
    const a = new ClipAssembler();
    const [g0] = splitClip(clip, 'x', GROUP_UID, 1000, 'aac');
    const [p0] = splitClip(clip, 'x', 42, 1000, 'aac');
    a.add(1, g0, 0);
    a.add(2, p0, 0);
    expect(a.size).toBe(2);
  });
});

describe('isClipForMe', () => {
  it('uses 0 for the group, a uid Agora never assigns', () => {
    expect(GROUP_UID).toBe(0);
  });

  it('takes group clips and clips addressed to our uid only', () => {
    expect(isClipForMe(GROUP_UID, 42)).toBe(true);
    expect(isClipForMe(GROUP_UID, null)).toBe(true);
    expect(isClipForMe(42, 42)).toBe(true);
    expect(isClipForMe(42, 7)).toBe(false);
    expect(isClipForMe(42, null)).toBe(false);
  });
});
```

In `src/ride/__tests__/protocol.test.ts`, line 92, change `v: 1, kind: 'state',` to `v: 2, kind: 'state',`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest src/ride --maxWorkers=1`
Expected: FAIL: `isClipForMe is not a function` in voiceClips.test.ts and `Expected: 2 / Received: 1` (`v`) in protocol.test.ts.

- [ ] **Step 3: Implement**

In `src/ride/voiceClips.ts`, replace the first three comment lines with:

```ts
// Voice memos between riders: a clip file is cut into base64 slices small
// enough for the Agora data stream (1 KB per message) and reassembled on the
// recipients' phones. `to` is one rider's uid (private memo) or GROUP_UID
// (every rider). See "Voice memos" in docs/watch-companion.md.
```

and add after `export const MAX_CLIP_CHARS = 120_000;`:

```ts

/** `to` of a memo for every rider of the channel: Agora never assigns uid 0. */
export const GROUP_UID = 0;

/** A memo is for us when it goes to the whole group or to our uid. */
export function isClipForMe(to: number, localUid: number | null): boolean {
  return to === GROUP_UID || (localUid !== null && to === localUid);
}
```

In `src/ride/protocol.ts`, replace `export const PROTOCOL_VERSION = 1;` with:

```ts
/**
 * 2 (ComX step 3): memos to the group travel as data-stream clips (`vc` with
 * `to: 0`) instead of being mixed into the live audio. Watches ignore `v`;
 * a phone on version 1 ignores group memos (see docs/watch-companion.md).
 */
export const PROTOCOL_VERSION = 2;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/ride --maxWorkers=1`
Expected: PASS, all `src/ride` suites.

- [ ] **Step 5: Commit**

```bash
git add src/ride/voiceClips.ts src/ride/protocol.ts src/ride/__tests__/voiceClips.test.ts src/ride/__tests__/protocol.test.ts
git commit -m "feat(ride): group voice memos (to: 0) and protocol version 2"
```

---

### Task 6: History trimming and the ride history

**Files:**
- Create: `src/ride/history.ts`
- Test: `src/ride/__tests__/history.test.ts`
- Modify: `src/contexts/RideContext.tsx`

- [ ] **Step 1: Write the failing test**

`src/ride/__tests__/history.test.ts`:

```ts
import {HISTORY_MAX_CLIPS, HISTORY_MAX_ITEMS, addToHistory} from '../history';

type Item = {key: string; clip?: {n: number}};
const text = (key: string): Item => ({key});
const voice = (key: string): Item => ({key, clip: {n: 1}});
const keys = (items: Item[]) => items.map(i => i.key);

describe('addToHistory', () => {
  it('uses the watch limits', () => {
    expect(HISTORY_MAX_ITEMS).toBe(30);
    expect(HISTORY_MAX_CLIPS).toBe(10);
  });

  it('puts the newest item first', () => {
    expect(keys(addToHistory([text('a')], text('b')))).toEqual(['b', 'a']);
  });

  it('keeps 30 items and drops the oldest', () => {
    let h: Item[] = [];
    for (let i = 0; i < 31; i++) h = addToHistory(h, text(`t${i}`));
    expect(h).toHaveLength(30);
    expect(h[0].key).toBe('t30');
    expect(keys(h)).not.toContain('t0');
  });

  it('keeps the 10 newest voice memos and every text', () => {
    let h: Item[] = [];
    for (let i = 0; i < 11; i++) {
      h = addToHistory(h, voice(`v${i}`));
      h = addToHistory(h, text(`t${i}`));
    }
    expect(h.filter(i => i.clip)).toHaveLength(10);
    expect(keys(h)).not.toContain('v0');
    expect(keys(h)).toContain('v1');
    expect(h.filter(i => !i.clip)).toHaveLength(11);
  });

  it('accepts other limits', () => {
    const h = addToHistory([voice('v1'), text('t1'), voice('v0')], voice('v2'), 3, 1);
    expect(keys(h)).toEqual(['v2', 't1']);
  });

  it('does not change the list it is given', () => {
    const before = [text('a')];
    addToHistory(before, text('b'));
    expect(keys(before)).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/ride/__tests__/history.test.ts --maxWorkers=1`
Expected: FAIL, `Cannot find module '../history'`.

- [ ] **Step 3: Implement `src/ride/history.ts`**

```ts
// The MSG sheet history: quick messages, SOS and voice memos, newest first,
// kept for the app's run. Same limits and rule as the watch
// (ios/SoarXVoiceWatch/History.swift, MessageHistory.add).

export const HISTORY_MAX_ITEMS = 30;
/** Voice memos kept (their audio stays in memory, about 60 KB each). */
export const HISTORY_MAX_CLIPS = 10;

/**
 * Adds `item` in front. Drops items beyond `maxItems`, and voice items (with
 * a `clip`) beyond the `maxClips` newest ones.
 */
export function addToHistory<T extends {clip?: unknown}>(
  items: readonly T[],
  item: T,
  maxItems: number = HISTORY_MAX_ITEMS,
  maxClips: number = HISTORY_MAX_CLIPS,
): T[] {
  let clips = 0;
  return [item, ...items].filter((it, index) => {
    if (it.clip === undefined) return index < maxItems;
    clips += 1;
    return index < maxItems && clips <= maxClips;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/ride/__tests__/history.test.ts --maxWorkers=1`
Expected: PASS.

- [ ] **Step 5: Use it in `RideContext`**

In `src/contexts/RideContext.tsx`:

1. Replace

```ts
import {LatLon} from '../utils/geo';

const POSITION_BROADCAST_MS = 3000;
const MAX_MESSAGES = 20;
```

with

```ts
import {LatLon} from '../utils/geo';
import {addToHistory} from '../ride/history';

const POSITION_BROADCAST_MS = 3000;
```

2. Replace the `RideMessage` interface with

```ts
/** A voice memo's audio, kept in memory so it can be played again. */
export interface HistoryClip {
  base64: string;
  ext: string;
  durationMs: number;
}

export interface RideMessage {
  key: string;
  uid: number | null; // null = me
  from: string;
  id: string;
  text: string;
  t: number;
  /** Present on voice memos (replayable from the MSG sheet). */
  clip?: HistoryClip;
}
```

3. In `interface RideContextValue`, replace `messages: RideMessage[];` with

```ts
  /** History for the MSG sheet, newest first, kept for the app's run. */
  messages: RideMessage[];
```

and replace the `logMessage` member with

```ts
  /** Add a line to the history (no network); `clip` makes it a replayable memo. */
  logMessage: (from: string, id: string, text: string, uid?: number | null, clip?: HistoryClip) => void;
```

4. Replace `pushMessage` with

```ts
  const pushMessage = useCallback((m: Omit<RideMessage, 'key'>) => {
    const key = `${m.t}-${m.uid}-${m.id}-${Math.random().toString(36).slice(2, 6)}`;
    setMessages(prev => addToHistory(prev, {...m, key}));
  }, []);
```

5. The history outlives the channel. In the effect commented `// Forget riders who left, and everything when we leave`, change the comment to `// Forget riders who left, and positions and SOS when we leave (the history stays for the app's run)` and delete its `setMessages([]);` line. In the effect commented `// Leaving demo mode forgets everything it produced`, delete the `setMessages([]);` line inside `if (!connected) {`.

6. Replace `logMessage` with

```ts
  const logMessage = useCallback(
    (from: string, id: string, text: string, uid: number | null = null, clip?: HistoryClip) => {
      pushMessage({uid, from, id, text, t: Date.now(), clip});
    },
    [pushMessage],
  );
```

- [ ] **Step 6: Type-check and test**

Run: `npx tsc --noEmit && npx jest --maxWorkers=1 2>&1 | tail -4`
Expected: no tsc output; all suites pass.

- [ ] **Step 7: Commit**

```bash
git add src/ride/history.ts src/ride/__tests__/history.test.ts src/contexts/RideContext.tsx
git commit -m "feat(ride): history of 30 items / 10 memos, kept for the app run"
```

---

### Task 7: Memo helpers

**Files:**
- Create: `src/memo/memo.ts`
- Test: `src/memo/__tests__/memo.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import {
  MEMO_MAX_MS,
  MEMO_MIN_MS,
  historyTitle,
  memoDurationMs,
  memoRecipient,
  memoSecondsLeft,
  memoSummary,
  newClipId,
} from '../memo';

describe('memo limits', () => {
  it('caps a memo at 30 s and ignores taps shorter than 0.6 s', () => {
    expect(MEMO_MAX_MS).toBe(30_000);
    expect(MEMO_MIN_MS).toBe(600);
  });

  it('counts down whole seconds to 0', () => {
    expect(memoSecondsLeft(1000, 1000)).toBe(30);
    expect(memoSecondsLeft(0, 200)).toBe(30);
    expect(memoSecondsLeft(0, 29_100)).toBe(1);
    expect(memoSecondsLeft(0, 30_000)).toBe(0);
    expect(memoSecondsLeft(0, 45_000)).toBe(0);
  });

  it('measures the recorded length within 0 and 30 s', () => {
    expect(memoDurationMs(0, 4200)).toBe(4200);
    expect(memoDurationMs(0, 45_000)).toBe(30_000);
    expect(memoDurationMs(100, 50)).toBe(0);
  });
});

describe('memoRecipient', () => {
  it('sends to the group unless a rider uid is given', () => {
    expect(memoRecipient(undefined)).toBe(0);
    expect(memoRecipient(null)).toBe(0);
    expect(memoRecipient(0)).toBe(0);
    expect(memoRecipient(NaN)).toBe(0);
    expect(memoRecipient('42')).toBe(0);
    expect(memoRecipient(42)).toBe(42);
    expect(memoRecipient(3_000_000_000)).toBe(3_000_000_000);
  });
});

describe('labels', () => {
  it('summarises a memo like the watch history', () => {
    expect(memoSummary(6200)).toBe('Voice, 6 s');
    expect(memoSummary(300)).toBe('Voice, 1 s');
  });

  it('titles a history row "NAME · HH:MM"', () => {
    expect(historyTitle('Léa', new Date(2026, 9, 19, 9, 5).getTime())).toBe('LÉA · 09:05');
    expect(historyTitle('To group', new Date(2026, 9, 19, 14, 30).getTime())).toBe('TO GROUP · 14:30');
  });

  it('makes short clip ids', () => {
    expect(newClipId(36, () => 0.5)).toBe('10i');
    expect(newClipId(Date.now())).toMatch(/^[0-9a-z]+$/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/memo --maxWorkers=1`
Expected: FAIL, `Cannot find module '../memo'`.

- [ ] **Step 3: Implement `src/memo/memo.ts`**

```ts
// Voice memo rules shared by the MEMO button, the watch clips and the history.

import {GROUP_UID} from '../ride/voiceClips';

/** A memo is sent by itself after 30 s (spec: clips are capped at 30 s). */
export const MEMO_MAX_MS = 30_000;
/** Shorter recordings are a mis-tap and are not sent. */
export const MEMO_MIN_MS = 600;

/** Whole seconds left on the MEMO button while recording. */
export function memoSecondsLeft(startedAt: number, now: number): number {
  return Math.max(0, Math.ceil((MEMO_MAX_MS - (now - startedAt)) / 1000));
}

export function memoDurationMs(startedAt: number, stoppedAt: number): number {
  return Math.min(MEMO_MAX_MS, Math.max(0, stoppedAt - startedAt));
}

/** A rider uid, else the whole group (GROUP_UID). Accepts a watch's `to`. */
export function memoRecipient(to: unknown): number {
  return typeof to === 'number' && Number.isFinite(to) && to !== GROUP_UID ? to : GROUP_UID;
}

/** "Voice, 6 s", as on the watch history. */
export function memoSummary(durationMs: number): string {
  return `Voice, ${Math.max(1, Math.round(durationMs / 1000))} s`;
}

/** Short id for the slices of one memo. */
export function newClipId(now: number, random: () => number = Math.random): string {
  return `${now.toString(36)}${random().toString(36).slice(2, 6)}`;
}

/** History row title: "LÉA · 09:41". */
export function historyTitle(from: string, t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${from} · ${pad(d.getHours())}:${pad(d.getMinutes())}`.toUpperCase();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/memo --maxWorkers=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/memo/memo.ts src/memo/__tests__/memo.test.ts
git commit -m "feat(memo): memo limits, recipient and history labels"
```

---

### Task 8: Mic policy without clip injection

Watch group clips stop being mixed into the live audio (Task 13), so the `injecting` input goes away.

**Files:**
- Modify: `src/ride/micPolicy.ts`, `src/ride/__tests__/micPolicy.test.ts`

- [ ] **Step 1: Update the test first**

In `src/ride/__tests__/micPolicy.test.ts`, delete the `injecting: false,` line from `base`, and delete the whole test `it('keeps the stream published while a clip is injected', ...)` (three lines).

- [ ] **Step 2: Run tsc to see the contract break**

Run: `npx tsc --noEmit`
Expected: error in `micPolicy.test.ts`: `Property 'injecting' is missing in type ... but required in type 'MicPolicyInput'`.

- [ ] **Step 3: Implement**

In `src/ride/micPolicy.ts`, delete

```ts
  /** A watch clip is being played into the channel. */
  injecting: boolean;
```

and replace `else if (watchMode || pttMode || i.injecting) override = 'silenced';` with `else if (watchMode || pttMode) override = 'silenced';`.

`WatchContext.tsx` still passes `injecting` until Task 13; keep tsc green meanwhile by deleting `injecting,` from its `micPolicy({...})` call now (the `injecting` state stays declared and is removed in Task 13).

- [ ] **Step 4: Check**

Run: `npx tsc --noEmit && npx jest src/ride --maxWorkers=1 2>&1 | tail -4`
Expected: no tsc output; `src/ride` suites pass.

- [ ] **Step 5: Commit**

```bash
git add src/ride/micPolicy.ts src/ride/__tests__/micPolicy.test.ts src/contexts/WatchContext.tsx
git commit -m "refactor(ride): mic policy no longer injects watch clips"
```

---

### Task 9: Bundle Barlow and Barlow Condensed

**Files:**
- Create: `assets/fonts/Barlow-Medium.ttf`, `Barlow-SemiBold.ttf`, `Barlow-Bold.ttf`, `BarlowCondensed-SemiBold.ttf`, `BarlowCondensed-Bold.ttf`, `BarlowCondensed-ExtraBold.ttf`, `OFL.txt`
- Create: `scripts/add-phone-fonts.rb`
- Modify: `android/app/build.gradle` (sourceSets), `ios/SoarXVoice/Info.plist` and `ios/SoarXVoice.xcodeproj/project.pbxproj` (by the script)

Source: Google Fonts' repository, OFL licence: <https://github.com/google/fonts/tree/main/ofl/barlow> and <https://github.com/google/fonts/tree/main/ofl/barlowcondensed>. Seven files, about 100 KB each. Ask the owner before downloading if the session requires it.

- [ ] **Step 1: Download the fonts and the licence**

```bash
mkdir -p assets/fonts
B=https://raw.githubusercontent.com/google/fonts/main/ofl
for f in Barlow-Medium Barlow-SemiBold Barlow-Bold; do
  curl -fsSL -o "assets/fonts/$f.ttf" "$B/barlow/$f.ttf"
done
for f in BarlowCondensed-SemiBold BarlowCondensed-Bold BarlowCondensed-ExtraBold; do
  curl -fsSL -o "assets/fonts/$f.ttf" "$B/barlowcondensed/$f.ttf"
done
curl -fsSL -o assets/fonts/OFL.txt "$B/barlow/OFL.txt"
file assets/fonts/*.ttf
```

Expected: six lines ending in `TrueType Font data, ...`.

- [ ] **Step 2: Check each PostScript name equals its file name (iOS looks fonts up by PostScript name, Android by file name)**

```bash
cat > "$TMPDIR/psname.swift" <<'EOF'
import CoreText
import Foundation
for path in CommandLine.arguments.dropFirst() {
  let url = URL(fileURLWithPath: path) as CFURL
  let descs = CTFontManagerCreateFontDescriptorsFromURL(url) as? [CTFontDescriptor] ?? []
  let name = descs.first.flatMap { CTFontDescriptorCopyAttribute($0, kCTFontNameAttribute) as? String } ?? "?"
  print("\((path as NSString).lastPathComponent): \(name)")
}
EOF
swift "$TMPDIR/psname.swift" assets/fonts/*.ttf
```

Expected: `Barlow-Bold.ttf: Barlow-Bold`, …, `BarlowCondensed-ExtraBold.ttf: BarlowCondensed-ExtraBold` (each name = file name without `.ttf`). If one differs, rename the file to its PostScript name and update `fontFamily` in `src/theme.ts`.

- [ ] **Step 3: Write `scripts/add-phone-fonts.rb`**

```ruby
#!/usr/bin/env ruby
# frozen_string_literal: true

# Bundles the Barlow fonts (assets/fonts/*.ttf, SIL Open Font Licence) into
# the SoarXVoice iOS target and lists them under UIAppFonts. Idempotent: run
# it again after adding a font. Android reads the same files through
# android/app/build.gradle (assets srcDirs).
#
#   bundle exec ruby scripts/add-phone-fonts.rb

require "json"
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

system("plutil", "-replace", "UIAppFonts", "-json", JSON.generate(fonts), PLIST_PATH) or abort("plutil failed")
puts "UIAppFonts: #{fonts.join(', ')}"
```

- [ ] **Step 4: Run it**

```bash
export LANG=en_US.UTF-8 && bundle exec ruby scripts/add-phone-fonts.rb
git diff --stat ios/
```

Expected: six `… -> SoarXVoice Resources` lines and the `UIAppFonts` line; the diff touches only `ios/SoarXVoice.xcodeproj/project.pbxproj` and `ios/SoarXVoice/Info.plist`. Check `git diff ios/SoarXVoice/Info.plist` shows only the new `UIAppFonts` array; if `plutil` reformatted other lines, run `git checkout -- ios/SoarXVoice/Info.plist` and add the key by hand before `</dict>` at the end:

```xml
	<key>UIAppFonts</key>
	<array>
		<string>Barlow-Bold.ttf</string>
		<string>Barlow-Medium.ttf</string>
		<string>Barlow-SemiBold.ttf</string>
		<string>BarlowCondensed-Bold.ttf</string>
		<string>BarlowCondensed-ExtraBold.ttf</string>
		<string>BarlowCondensed-SemiBold.ttf</string>
	</array>
```

Running the script a second time prints only the `UIAppFonts` line (idempotent).

- [ ] **Step 5: Android reads the same folder**

In `android/app/build.gradle`, replace

```groovy
    sourceSets {
        // Wear OS Data Layer protocol, compiled verbatim into :wear as well.
        main.java.srcDirs += rootProject.file("watch-shared/src")
    }
```

with

```groovy
    sourceSets {
        // Wear OS Data Layer protocol, compiled verbatim into :wear as well.
        main.java.srcDirs += rootProject.file("watch-shared/src")
        // Barlow fonts: React Native loads assets/fonts/<family>.ttf.
        main.assets.srcDirs += rootProject.file("../assets")
    }
```

- [ ] **Step 6: Commit**

```bash
git add assets/fonts scripts/add-phone-fonts.rb android/app/build.gradle ios/SoarXVoice/Info.plist ios/SoarXVoice.xcodeproj/project.pbxproj
git commit -m "feat(phone): bundle Barlow and Barlow Condensed (OFL)"
```

---

### Task 10: Signal components (arrow, radar, rows, banner, controls, sheet)

**Files:**
- Create: `src/components/signal/Arrow.tsx`, `RadarView.tsx`, `RiderRow.tsx`, `Banner.tsx`, `ControlRow.tsx`, `BottomSheet.tsx`

All maths is in Tasks 2 and 3; these files are presentation and are checked on screen in Tasks 19 and 20.

- [ ] **Step 1: `src/components/signal/Arrow.tsx`**

```tsx
import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, View} from 'react-native';
import {nextRotation} from '../../radar/radar';

interface ArrowProps {
  /** Degrees clockwise from the top of the screen. */
  angle: number;
  color: string;
  /** The colour behind the arrow: it paints the notch of the shape. */
  backColor: string;
  width?: number;
  height?: number;
}

/**
 * The ComX arrow, polygon(50% 0, 100% 100%, 50% 75%, 0 100%), without SVG: a
 * border-drawn triangle with a flat triangle in the background colour cut out
 * of its base. Turns the short way in 300 ms, easing out.
 */
export function Arrow({angle, color, backColor, width = 20, height = 22}: ArrowProps) {
  const rotation = useRef(new Animated.Value(angle)).current;
  const shown = useRef(angle);

  useEffect(() => {
    const target = nextRotation(shown.current, angle);
    shown.current = target;
    Animated.timing(rotation, {
      toValue: target,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [angle, rotation]);

  const rotate = rotation.interpolate({
    inputRange: [-360, 360],
    outputRange: ['-360deg', '360deg'],
    extrapolate: 'extend',
  });
  const half = width / 2;

  return (
    <Animated.View style={{width, height, transform: [{rotate}]}}>
      <View
        style={[styles.triangle, {borderLeftWidth: half, borderRightWidth: half, borderBottomWidth: height, borderBottomColor: color}]}
      />
      <View
        style={[
          styles.triangle,
          styles.notch,
          {borderLeftWidth: half, borderRightWidth: half, borderBottomWidth: height * 0.25, borderBottomColor: backColor},
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  triangle: {
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  notch: {
    position: 'absolute',
    left: 0,
    bottom: 0,
  },
});
```

- [ ] **Step 2: `src/components/signal/RadarView.tsx`**

```tsx
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {RiderView} from '../../ride/protocol';
import {Point, initials, layoutRadar, point, ringDistance, shortDistance} from '../../radar/radar';
import {condensed, signal} from '../../theme';
import {Arrow} from './Arrow';

/** Badge diameter on the phone (the watch uses 34). */
export const BADGE = 44;
/** SOS badges are this much bigger. */
const SOS_GROWTH = 6;
/** Halo around a speaking badge (box-shadow 0 0 0 8px in the handoff). */
const HALO = 8;

interface RadarViewProps {
  riders: RiderView[];
  /** True bearing at the top of the screen (0 = north up). */
  heading: number;
  /** My course over ground, degrees true, or null when not moving. */
  myCourse: number | null;
  width: number;
  height: number;
}

/** Every rider on one radar, me in the centre (watch OverviewPage). */
export function RadarView({riders, heading, myCourse, width, height}: RadarViewProps) {
  const layout = layoutRadar(riders, width, height, heading, BADGE);
  const byUid = new Map(riders.map(r => [r.uid, r]));
  const {centre, radius} = layout;
  return (
    <View style={{width, height}} pointerEvents="none">
      <Ring centre={centre} radius={radius} label={ringDistance(layout.farthest)} />
      {layout.innerRadius !== null && (
        <Ring centre={centre} radius={layout.innerRadius} label={ringDistance(layout.inner)} />
      )}
      <Text style={[styles.north, {left: layout.north.x - 10, top: layout.north.y - 10}]}>N</Text>
      <View style={[styles.me, {left: centre.x - 10, top: centre.y - 11}]}>
        <Arrow angle={(myCourse ?? heading) - heading} color={signal.text} backColor={signal.bg} />
      </View>
      {layout.spots.map(s => {
        const rider = byUid.get(s.uid);
        return rider ? <Badge key={s.uid} rider={rider} at={s} /> : null;
      })}
    </View>
  );
}

function Ring({centre, radius, label}: {centre: Point; radius: number; label: string}) {
  // Label at the bottom right of the ring, where N rarely is.
  const at = point(centre, radius, 135, 1);
  return (
    <>
      <View
        style={[
          styles.ring,
          {left: centre.x - radius, top: centre.y - radius, width: radius * 2, height: radius * 2, borderRadius: radius},
        ]}
      />
      <Text style={[styles.ringLabel, {left: at.x - 30, top: at.y - 8}]}>{label}</Text>
    </>
  );
}

function Badge({rider, at}: {rider: RiderView; at: Point}) {
  const d = rider.sos ? BADGE + SOS_GROWTH : BADGE;
  const fill = rider.sos ? signal.red : rider.speaking ? signal.yellow : signal.teal;
  const halo = rider.speaking && !rider.sos;
  return (
    <View style={[styles.badgeBox, {left: at.x - d / 2 - HALO, top: at.y - d / 2 - HALO, opacity: rider.stale ? 0.4 : 1}]}>
      <View
        style={[
          styles.halo,
          {width: d + HALO * 2, height: d + HALO * 2, borderRadius: d / 2 + HALO},
          halo && styles.haloOn,
        ]}>
        <View style={[styles.badge, {width: d, height: d, borderRadius: d / 2, backgroundColor: fill}]}>
          <Text
            style={[styles.initials, {color: rider.sos ? signal.text : signal.onAccent}]}
            numberOfLines={1}
            adjustsFontSizeToFit>
            {initials(rider.name)}
          </Text>
        </View>
      </View>
      {/* Decision 6: distance under the badge, as on the watch. */}
      <Text style={styles.badgeDistance}>{shortDistance(rider.dist)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: signal.ring,
  },
  ringLabel: {
    position: 'absolute',
    width: 60,
    textAlign: 'center',
    color: signal.textDim,
    backgroundColor: signal.bg,
    ...condensed(12, 600),
  },
  north: {
    position: 'absolute',
    width: 20,
    textAlign: 'center',
    color: signal.red,
    ...condensed(15, 800),
  },
  me: {
    position: 'absolute',
    width: 20,
    height: 22,
  },
  badgeBox: {
    position: 'absolute',
    alignItems: 'center',
  },
  halo: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  haloOn: {
    backgroundColor: signal.yellowHalo,
  },
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    ...condensed(17, 800),
  },
  badgeDistance: {
    marginTop: -6,
    color: signal.text,
    ...condensed(12, 700),
  },
});
```

- [ ] **Step 3: `src/components/signal/RiderRow.tsx`**

```tsx
import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {RiderView} from '../../ride/protocol';
import {formatDistance} from '../../utils/geo';
import {condensed, plain, signal} from '../../theme';
import {Arrow} from './Arrow';

interface RiderRowProps {
  rider: RiderView;
  /** True bearing at the top of the screen. */
  heading: number;
  /** While a memo records, a tap sends it to this rider only. */
  onPress?: () => void;
}

/** A sheet row: arrow, name, distance. Yellow while speaking, red in SOS. */
export function RiderRow({rider, heading, onPress}: RiderRowProps) {
  const located = rider.dist !== null && rider.brg !== null;
  const fill = rider.sos ? signal.red : rider.speaking ? signal.yellow : null;
  const ink = rider.speaking && !rider.sos ? signal.onAccent : signal.text;
  const arrowColor = rider.sos ? signal.text : rider.speaking ? signal.onAccent : signal.teal;
  return (
    <TouchableOpacity
      disabled={!onPress}
      onPress={onPress}
      activeOpacity={0.6}
      accessibilityLabel={`${rider.name}, ${located ? formatDistance(rider.dist) : 'no GPS'}${rider.sos ? ', SOS' : ''}${onPress ? ', tap to send the memo to this rider' : ''}`}
      style={[
        styles.row,
        fill !== null && {backgroundColor: fill},
        onPress !== undefined && styles.target,
        !located && styles.noGps,
        located && rider.stale && styles.stale,
      ]}>
      {located ? (
        <Arrow angle={(rider.brg as number) - heading} color={arrowColor} backColor={fill ?? signal.surface} />
      ) : (
        <View style={styles.hollow} />
      )}
      <Text style={[styles.name, {color: ink}]} numberOfLines={1}>
        {rider.name}
      </Text>
      {rider.sos && (
        <View style={styles.sosChip}>
          <Text style={styles.sosText}>SOS</Text>
        </View>
      )}
      {located ? (
        <Text style={[styles.distance, {color: ink}]}>{formatDistance(rider.dist).toUpperCase()}</Text>
      ) : (
        <Text style={[styles.noGpsText, {color: ink}]}>No GPS</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  target: {
    borderColor: signal.teal,
  },
  noGps: {
    opacity: 0.45,
  },
  stale: {
    opacity: 0.6,
  },
  hollow: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: signal.textMuted,
  },
  name: {
    flex: 1,
    ...condensed(20, 800),
  },
  sosChip: {
    backgroundColor: signal.text,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  sosText: {
    color: signal.red,
    ...condensed(14, 800, 1),
  },
  distance: {
    ...condensed(22, 800),
  },
  noGpsText: {
    ...plain(15, 700),
  },
});
```

- [ ] **Step 4: `src/components/signal/Banner.tsx`**

```tsx
import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {condensed, plain, signal} from '../../theme';

interface BannerProps {
  text: string;
  /** Amber for warnings, red while a memo records. */
  tone?: 'amber' | 'red';
  action?: {label: string; onPress: () => void};
}

/** Full-width pill under the top overlay (inactivity, call, location, memo). */
export function Banner({text, tone = 'amber', action}: BannerProps) {
  const bg = tone === 'red' ? signal.red : signal.amber;
  const ink = tone === 'red' ? signal.text : signal.onAccent;
  return (
    <View style={[styles.pill, {backgroundColor: bg}]} accessibilityRole="alert">
      <Text style={[styles.text, {color: ink}]}>{text}</Text>
      {action && (
        <TouchableOpacity style={[styles.action, {backgroundColor: ink}]} onPress={action.onPress} hitSlop={8}>
          <Text style={[styles.actionText, {color: bg}]}>{action.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 9999,
    paddingVertical: 10,
    paddingLeft: 18,
    paddingRight: 10,
  },
  text: {
    flex: 1,
    ...plain(14, 700),
  },
  action: {
    borderRadius: 9999,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  actionText: {
    ...condensed(15, 800, 1),
  },
});
```

- [ ] **Step 5: `src/components/signal/ControlRow.tsx`**

```tsx
import React from 'react';
import {StyleSheet, Text, TouchableOpacity, Vibration, View} from 'react-native';
import {CONTROL_HEIGHT} from '../../radar/sheet';
import {condensed, signal} from '../../theme';

/** What the TALK slot shows. */
export type TalkState = 'muted' | 'live' | 'watch' | 'garmin' | 'garminTalking';

interface ControlRowProps {
  mySos: boolean;
  onSos: (active: boolean) => void;
  talk: TalkState;
  onTalk: () => void;
  memoRecording: boolean;
  memoSecondsLeft: number;
  memoEnabled: boolean;
  onMemo: () => void;
  onMsg: () => void;
}

/** SOS · TALK · MEMO · MSG, pinned to the bottom of the sheet. */
export function ControlRow(p: ControlRowProps) {
  const memoDisabled = !p.memoEnabled && !p.memoRecording;
  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={[styles.round, p.mySos ? styles.sosOn : styles.sosOff]}
        onPress={() => p.mySos && p.onSos(false)}
        onLongPress={() => {
          if (p.mySos) return;
          Vibration.vibrate(400);
          p.onSos(true);
        }}
        delayLongPress={1000}
        activeOpacity={0.7}
        accessibilityLabel={p.mySos ? 'Cancel my SOS' : 'SOS, hold one second'}>
        <Text style={[styles.sosText, p.mySos && styles.sosCancel]}>{p.mySos ? 'CANCEL' : 'SOS'}</Text>
      </TouchableOpacity>

      <TalkButton state={p.talk} onPress={p.onTalk} />

      <TouchableOpacity
        style={[styles.round, p.memoRecording ? styles.memoOn : styles.secondary, memoDisabled && styles.disabled]}
        disabled={memoDisabled}
        onPress={p.onMemo}
        activeOpacity={0.7}
        accessibilityLabel={p.memoRecording ? `Send the memo to the group, ${p.memoSecondsLeft} seconds left` : 'Record a voice memo'}>
        {p.memoRecording ? (
          <>
            <Text style={styles.memoSend}>SEND</Text>
            <Text style={styles.memoCount}>{p.memoSecondsLeft}</Text>
          </>
        ) : (
          <Text style={styles.secondaryText}>MEMO</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={[styles.round, styles.secondary]} onPress={p.onMsg} activeOpacity={0.7} accessibilityLabel="Messages">
        <Text style={styles.secondaryText}>MSG</Text>
      </TouchableOpacity>
    </View>
  );
}

function TalkButton({state, onPress}: {state: TalkState; onPress: () => void}) {
  if (state === 'watch' || state === 'garmin' || state === 'garminTalking') {
    const title = state === 'watch' ? 'WATCH MODE' : 'GARMIN';
    const sub = state === 'watch' ? 'TALK ON YOUR WATCH' : state === 'garminTalking' ? 'PHONE MIC ON' : 'TALK VIA PHONE';
    return (
      <View style={[styles.talk, styles.talkWatch]} accessibilityLabel={`${title}, ${sub}`}>
        <Text style={styles.watchTitle} numberOfLines={1} adjustsFontSizeToFit>
          {title}
        </Text>
        <Text style={styles.watchSub} numberOfLines={1} adjustsFontSizeToFit>
          {sub}
        </Text>
      </View>
    );
  }
  const live = state === 'live';
  return (
    <TouchableOpacity
      style={[styles.talk, {backgroundColor: live ? signal.yellow : signal.teal}]}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityLabel={live ? 'Live, tap to mute' : 'Muted, tap to talk'}>
      <Text style={styles.talkText}>{live ? 'LIVE' : 'TALK'}</Text>
      <Text style={styles.talkSub} numberOfLines={1} adjustsFontSizeToFit>
        {live ? 'TAP TO MUTE' : 'TAP TO TALK'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    height: CONTROL_HEIGHT,
  },
  round: {
    width: CONTROL_HEIGHT,
    height: CONTROL_HEIGHT,
    borderRadius: CONTROL_HEIGHT / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosOff: {
    borderWidth: 2,
    borderColor: signal.red,
  },
  sosOn: {
    backgroundColor: signal.red,
  },
  sosText: {
    color: signal.red,
    ...condensed(17, 800),
  },
  sosCancel: {
    color: signal.text,
    fontSize: 14,
  },
  talk: {
    flex: 1,
    height: CONTROL_HEIGHT,
    borderRadius: CONTROL_HEIGHT / 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  talkText: {
    color: signal.onAccent,
    lineHeight: 26,
    ...condensed(24, 800, 1),
  },
  talkSub: {
    color: signal.onAccent,
    ...condensed(11, 700, 1),
  },
  talkWatch: {
    backgroundColor: signal.surfaceAlt,
  },
  watchTitle: {
    color: signal.teal,
    ...condensed(15, 800, 1),
  },
  watchSub: {
    color: signal.textMuted,
    ...condensed(11, 700, 1),
  },
  secondary: {
    backgroundColor: signal.surfaceAlt,
  },
  secondaryText: {
    color: signal.text,
    ...condensed(14, 700, 1),
  },
  memoOn: {
    backgroundColor: signal.red,
  },
  memoSend: {
    color: signal.text,
    lineHeight: 14,
    ...condensed(12, 800, 1),
  },
  memoCount: {
    color: signal.text,
    lineHeight: 22,
    ...condensed(22, 800),
  },
  disabled: {
    opacity: 0.35,
  },
});
```

- [ ] **Step 6: `src/components/signal/BottomSheet.tsx`**

```tsx
import React, {ReactNode, useCallback, useEffect, useRef, useState} from 'react';
import {Animated, PanResponder, ScrollView, StyleSheet, View} from 'react-native';
import {Detents, HANDLE_HEIGHT, clampSheet, nextDetent, settleDetent} from '../../radar/sheet';
import {signal} from '../../theme';

interface BottomSheetProps {
  detents: Detents;
  /** Padding under the footer (home indicator). */
  bottomPad: number;
  /** Rider rows; they scroll only at the large detent. */
  children: ReactNode;
  /** Always visible at the bottom (the control row). */
  footer: ReactNode;
}

/**
 * The live screen's sheet. Its height animates between three detents
 * (src/radar/sheet.ts); the footer is never pushed off screen. Drag the
 * grabber to move it, tap the grabber to cycle detents.
 */
export function BottomSheet({detents, bottomPad, children, footer}: BottomSheetProps) {
  const height = useRef(new Animated.Value(detents.medium)).current;
  const current = useRef(detents.medium);
  const start = useRef(detents.medium);
  const detentsRef = useRef(detents);
  detentsRef.current = detents;
  const [expanded, setExpanded] = useState(false);

  const settle = useCallback(
    (target: number) => {
      current.current = target;
      setExpanded(target === detentsRef.current.large);
      Animated.spring(height, {toValue: target, useNativeDriver: false, bounciness: 0, speed: 18}).start();
    },
    [height],
  );

  // Screen size changed (rotation, split view): stay on the same detent kind
  useEffect(() => {
    settle(detents.medium);
  }, [detents, settle]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        start.current = current.current;
      },
      onPanResponderMove: (_e, g) => {
        height.setValue(clampSheet(start.current - g.dy, detentsRef.current));
      },
      onPanResponderRelease: (_e, g) => {
        if (Math.abs(g.dy) < 4) {
          settle(nextDetent(current.current, detentsRef.current));
          return;
        }
        settle(settleDetent(clampSheet(start.current - g.dy, detentsRef.current), g.vy, detentsRef.current));
      },
    }),
  ).current;

  return (
    <Animated.View style={[styles.sheet, {height, paddingBottom: bottomPad}]}>
      <View {...pan.panHandlers} style={styles.handle} accessibilityLabel="Riders sheet, drag or tap to resize">
        <View style={styles.grabber} />
      </View>
      <ScrollView style={styles.list} scrollEnabled={expanded} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
      <View style={styles.footer}>{footer}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: signal.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 10,
    paddingHorizontal: 18,
    overflow: 'hidden',
  },
  handle: {
    height: HANDLE_HEIGHT,
    alignItems: 'center',
  },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: signal.outline,
  },
  list: {
    flex: 1,
  },
  footer: {
    paddingTop: 8,
  },
});
```

- [ ] **Step 7: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src --quiet`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add src/components/signal
git commit -m "feat(phone): Signal radar, rider row, banner, control row and sheet"
```

---

### Task 11: Android bridge reads and writes clips

`readClipBase64` and `writeClip` exist only on iOS (`ios/WatchBridge.swift`); on Android `WatchBridge.readClipBase64` returns null today, so private voice messages never left an Android phone. Memos need both.

**Files:**
- Modify: `android/app/src/main/java/com/soarxvoice/watch/WatchBridgeModule.kt`, `src/services/WatchBridge.ts`

- [ ] **Step 1: Add the methods**

In `WatchBridgeModule.kt`, add after the `getClipDir` method:

```kotlin
    /** Reads a clip as base64 (no line breaks), to send it over the data stream. */
    @ReactMethod
    fun readClipBase64(path: String, promise: Promise) {
        try {
            val file = File(path.removePrefix("file://"))
            promise.resolve(android.util.Base64.encodeToString(file.readBytes(), android.util.Base64.NO_WRAP))
        } catch (e: Exception) {
            promise.reject("E_READ_CLIP", "Cannot read $path: ${e.message}", e)
        }
    }

    /**
     * Writes a received clip into [getClipDir] and resolves its absolute path.
     * Like any file there, it is deleted by [sendClip] once delivered.
     */
    @ReactMethod
    fun writeClip(base64: String, ext: String, promise: Promise) {
        try {
            val data = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
            if (data.isEmpty()) {
                promise.reject("E_WRITE_CLIP", "Clip is empty")
                return
            }
            val clean = ext.lowercase().filter { it.isLetterOrDigit() }
            val suffix = if (clean.isEmpty() || clean.length > 5) "m4a" else clean
            val name = "vc-${System.currentTimeMillis()}-${java.util.UUID.randomUUID().toString().take(8)}.$suffix"
            val file = File(WatchHub.clipDir(reactContext), name)
            file.writeBytes(data)
            promise.resolve(file.absolutePath)
        } catch (e: Exception) {
            // IllegalArgumentException for bad base64, IOException for the disk
            promise.reject("E_WRITE_CLIP", "Cannot write clip: ${e.message}", e)
        }
    }
```

- [ ] **Step 2: Fix the JS doc comment**

In `src/services/WatchBridge.ts`, replace `/** Read a clip as base64 to send it to one rider over the data stream. */` with `/** Read a clip as base64 to send it as a memo over the data stream. */`.

- [ ] **Step 3: Compile the Android app (Mac only)**

Run: `cd android && ./gradlew :app:compileDebugKotlin -q; cd ..`
Expected: no `e:` error lines (warnings are fine).

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/com/soarxvoice/watch/WatchBridgeModule.kt src/services/WatchBridge.ts
git commit -m "feat(android): readClipBase64 and writeClip in the watch bridge"
```

---

### Task 12: Memo capture in AgoraContext

While a phone memo records, the live stream is muted (others hear nothing live) and the mic is captured at full volume (watch mode captures it at 0) so Agora's file recorder gets the voice.

**Files:**
- Modify: `src/contexts/AgoraContext.tsx`

- [ ] **Step 1: Interface**

After the `localUid: number | null;` member of `interface AgoraContextValue`, add:

```ts
  /**
   * A phone voice memo is recording: the live stream is muted and the mic is
   * captured at full volume (even in watch mode) for Agora's file recorder.
   */
  setMemoCapture: (on: boolean) => void;
  /** True while a phone memo records (read by the watch's remote-speech recorder). */
  isMemoCapture: () => boolean;
```

- [ ] **Step 2: Ref**

After `const [micOverride, setMicOverrideState] = useState<MicOverride>('normal');`, add:

```ts
  const memoCaptureRef = useRef(false);
```

- [ ] **Step 3: Stream mute and recording volume**

Replace

```ts
  // The stream must stay published while the phone mic is silenced, otherwise
  // the watch clips mixed into it would never leave the phone.
  const applyLocalStreamMute = useCallback((engine: IRtcEngine) => {
    engine.muteLocalAudioStream(micOverrideRef.current === 'normal' ? isMutedRef.current : false);
  }, []);
```

with

```ts
  // A memo being recorded always mutes the live stream. Otherwise the mute
  // button decides, except under a watch override ('silenced' keeps the
  // stream published at volume 0, 'open' is the Garmin "talk via phone").
  const applyLocalStreamMute = useCallback((engine: IRtcEngine) => {
    const muted = memoCaptureRef.current || (micOverrideRef.current === 'normal' ? isMutedRef.current : false);
    engine.muteLocalAudioStream(muted);
  }, []);

  // Watch mode captures the mic at volume 0 (pouch); a phone memo needs it back.
  const applyRecordingVolume = useCallback((engine: IRtcEngine) => {
    engine.adjustRecordingSignalVolume(!memoCaptureRef.current && micOverrideRef.current === 'silenced' ? 0 : 100);
  }, []);
```

- [ ] **Step 4: Use it in `setMicOverride` and add `setMemoCapture`**

Replace the whole `setMicOverride` callback with:

```ts
  const setMicOverride = useCallback((mode: MicOverride) => {
    if (micOverrideRef.current === mode) return;
    micOverrideRef.current = mode;
    setMicOverrideState(mode);
    const engine = engineRef.current;
    if (!engine) return;
    applyRecordingVolume(engine);
    applyLocalStreamMute(engine);
    appLog('Agora', `phone mic override: ${mode}`);
  }, [applyLocalStreamMute, applyRecordingVolume]);

  const setMemoCapture = useCallback((on: boolean) => {
    if (memoCaptureRef.current === on) return;
    memoCaptureRef.current = on;
    const engine = engineRef.current;
    if (!engine) return;
    applyRecordingVolume(engine);
    applyLocalStreamMute(engine);
    appLog('Agora', `memo capture ${on ? 'on' : 'off'}`);
  }, [applyLocalStreamMute, applyRecordingVolume]);

  const isMemoCapture = useCallback(() => memoCaptureRef.current, []);
```

- [ ] **Step 5: Reset on leave**

In `leaveChannel`, after `setMicOverrideState('normal');`, add `memoCaptureRef.current = false;`.

- [ ] **Step 6: Provide it**

In the provider `value`, after `localUid,`, add:

```ts
        setMemoCapture,
        isMemoCapture,
```

- [ ] **Step 7: Check**

Run: `npx tsc --noEmit && npx eslint src --quiet && npx jest --maxWorkers=1 2>&1 | tail -4`
Expected: no tsc / eslint output; all suites pass.

- [ ] **Step 8: Commit**

```bash
git add src/contexts/AgoraContext.tsx
git commit -m "feat(agora): memo capture mutes the live stream and restores the mic level"
```

---

### Task 13: WatchContext keeps the watch link only

The watch-clip injection (`startAudioMixing` into the channel), the private-clip send/receive and the demo echo move to `MemoContext` (Task 14). Today a watch group clip is injected at `WatchBridge.onClip` → `clipQueueRef.current.push(...)` → `playNextClip` → `engine.startAudioMixing(next.path, false, 1)`; that path is removed. The remote-speech recorder pauses while a phone memo owns Agora's single file recorder.

**Files:**
- Modify (replace whole file): `src/contexts/WatchContext.tsx`

- [ ] **Step 1: Replace `src/contexts/WatchContext.tsx`**

```tsx
// Bridges the channel to the rider's watch (Apple Watch, Wear OS, Garmin).
// The phone stays in the Agora channel; the watch is its microphone, speaker
// and screen. Voice memos (watch or phone, group or private) are handled by
// MemoContext. See docs/watch-companion.md.

import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {AudioFileRecordingType, AudioRecordingQualityType} from 'react-native-agora';
import {useAgoraContext} from './AgoraContext';
import {useUser} from './UserContext';
import {useRide} from './RideContext';
import {WatchBridge, WatchInfo, WatchPlatform, VOICE_PLATFORMS, isActiveWatch} from '../services/WatchBridge';
import {PROTOCOL_VERSION, buildWatchState, parseWatchMessage} from '../ride/protocol';
import {appLog} from '../utils/logger';
import {micPolicy, WatchModeSetting} from '../ride/micPolicy';

export type {WatchModeSetting};
const SETTING_KEY = '@soarx_watch_mode';

const STATE_INTERVAL_MS = 2000;
/** Remote speech is cut into a clip after this much silence. */
const CLIP_SILENCE_MS = 1200;
const CLIP_MAX_MS = 30_000;
const CLIP_MIN_MS = 400;
/** A rider counts as done talking after this much silence. */
const SPEAKING_END_MS = 1500;
/** A watch that said hello is considered active for this long. */
const HELLO_TTL_MS = 5 * 60_000;
/** "Talk via phone" closes by itself after this long. */
const PTT_TIMEOUT_MS = 60_000;

interface WatchContextValue {
  available: boolean;
  watches: WatchInfo[];
  /** True when the phone mic is off and voice goes through the watch. */
  watchMode: boolean;
  /** An Apple Watch or Wear OS watch with ComX is active: memos go to it. */
  voiceWatch: boolean;
  setting: WatchModeSetting;
  setSetting: (s: WatchModeSetting) => void;
  /**
   * A Garmin (no microphone) is in use: the phone mic stays off except while
   * the rider holds "talk via phone" on the watch.
   */
  pttMode: boolean;
  /** "Talk via phone" is active right now. */
  phonePtt: boolean;
}

const WatchContext = createContext<WatchContextValue | null>(null);

export function WatchProvider({children}: {children: ReactNode}) {
  const {
    connectionState, channelName, getEngine, setMicOverride, isHeadphonesConnected, isMemoCapture,
  } = useAgoraContext();
  const {pilotName} = useUser();
  const {myPosition, riders, sendQuickMessage, setSos, subscribeRideEvents, demo} = useRide();
  const connected = connectionState === 'connected';

  const [watches, setWatches] = useState<WatchInfo[]>([]);
  const [setting, setSettingState] = useState<WatchModeSetting>('auto');
  const [phonePtt, setPhonePtt] = useState(false);
  const [helloAt, setHelloAt] = useState<Partial<Record<WatchPlatform, number>>>({});
  const clipDirRef = useRef<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(SETTING_KEY).then(v => {
      if (v === 'on' || v === 'off' || v === 'auto') setSettingState(v);
    });
  }, []);

  const setSetting = useCallback((s: WatchModeSetting) => {
    setSettingState(s);
    AsyncStorage.setItem(SETTING_KEY, s);
  }, []);

  // Native links and watch status
  useEffect(() => {
    if (!WatchBridge.available) return;
    WatchBridge.start();
    WatchBridge.getStatus().then(setWatches);
    WatchBridge.getClipDir().then(dir => {
      clipDirRef.current = dir;
    });
    const sub = WatchBridge.onStatus(e => setWatches(e.watches ?? []));
    return () => sub?.remove();
  }, []);

  const now = Date.now();
  const voiceWatchActive =
    watches.some(w => isActiveWatch(w) && VOICE_PLATFORMS.includes(w.platform)) ||
    VOICE_PLATFORMS.some(p => (helloAt[p] ?? 0) > now - HELLO_TTL_MS);

  const garminActive =
    watches.some(w => isActiveWatch(w) && w.platform === 'garmin') ||
    (helloAt.garmin ?? 0) > now - HELLO_TTL_MS;

  const {watchMode, pttMode, override} = micPolicy({
    connected,
    setting,
    voiceWatchActive,
    garminActive,
    headphones: isHeadphonesConnected,
    phonePtt,
  });

  // If the Garmin drops while "talk via phone" is on, never leave the mic open
  useEffect(() => {
    if (!phonePtt) return;
    const timer = setTimeout(() => {
      appLog('Watch', 'talk via phone timed out');
      setPhonePtt(false);
    }, PTT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phonePtt]);

  // Phone mic: off while it sits in a pouch, open while "talk via phone" is
  // held on a Garmin.
  useEffect(() => {
    if (connected) setMicOverride(override);
  }, [connected, override, setMicOverride]);

  // ---- Messages from watches ------------------------------------------------
  useEffect(() => {
    const msgSub = WatchBridge.onMessage(({platform, json}) => {
      const msg = parseWatchMessage(json);
      if (!msg) return;
      switch (msg.kind) {
        case 'hello':
          appLog('Watch', `hello from ${platform} ${msg.model ?? ''}`);
          setHelloAt(prev => ({...prev, [platform]: Date.now()}));
          break;
        case 'text':
          sendQuickMessage(msg.id, msg.text);
          break;
        case 'sos':
          setSos(msg.active);
          break;
        case 'ptt':
          setPhonePtt(msg.active);
          break;
      }
    });
    // The clip itself is MemoContext's; it still proves the watch is there.
    const clipSub = WatchBridge.onClip(({platform}) => {
      setHelloAt(prev => ({...prev, [platform]: Date.now()}));
    });
    return () => {
      msgSub?.remove();
      clipSub?.remove();
    };
  }, [sendQuickMessage, setSos]);

  // ---- Channel → watches ----------------------------------------------------
  const stateRef = useRef<object | null>(null);
  // Demo mode without a channel still looks like one to the watch
  const demoOnly = demo && !connected;
  stateRef.current = buildWatchState({
    connected: connected || demo,
    channel: demoOnly ? 'Demo' : channelName,
    watchMode,
    myName: pilotName,
    me: myPosition,
    riders,
    now,
  });

  useEffect(() => {
    if (!WatchBridge.available) return;
    if (stateRef.current) WatchBridge.sendState(stateRef.current);
    const timer = setInterval(() => {
      if (stateRef.current) WatchBridge.sendState(stateRef.current);
    }, STATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [connected, watchMode, demo]);

  // Text and SOS events
  const ridersRef = useRef(riders);
  ridersRef.current = riders;
  useEffect(() => {
    return subscribeRideEvents(e => {
      const rider = ridersRef.current.find(r => r.uid === e.uid);
      if (e.type === 'text') {
        WatchBridge.sendEvent({v: PROTOCOL_VERSION, kind: 'event', type: 'text', uid: e.uid, from: e.from, id: e.id, text: e.text});
      } else {
        WatchBridge.sendEvent({
          v: PROTOCOL_VERSION, kind: 'event', type: 'sos', uid: e.uid, from: e.from, active: e.active,
          dist: rider?.dist ?? null, brg: rider?.brg ?? null,
        });
      }
    });
  }, [subscribeRideEvents]);

  // Speaking events + remote speech recorded into clips for the watch speaker
  const recordingRef = useRef<{path: string; startedAt: number; lastVoiceAt: number; uids: Set<number>} | null>(null);

  /** `engineStopped`: a phone memo already stopped Agora's recorder. */
  const stopRecording = useCallback((engineStopped = false) => {
    const engine = getEngine();
    const rec = recordingRef.current;
    recordingRef.current = null;
    if (!engine || !rec) return;
    if (!engineStopped) engine.stopAudioRecording();
    const durationMs = Math.min(Date.now(), rec.lastVoiceAt + 300) - rec.startedAt;
    if (durationMs < CLIP_MIN_MS) return;
    const names = [...rec.uids].map(uid => ridersRef.current.find(r => r.uid === uid)?.name ?? 'A rider');
    const uid = [...rec.uids][0] ?? 0;
    // Let the SDK finish writing the file
    setTimeout(() => {
      WatchBridge.sendClip(rec.path, {v: PROTOCOL_VERSION, kind: 'clip', uid, from: names.join(', '), durationMs});
    }, 400);
  }, [getEngine]);

  // Tell watches who is talking (haptic cue before the clip arrives). Volume
  // drops between words, so "stopped" is only sent after a real pause.
  useEffect(() => {
    if (!connected || !WatchBridge.available) return;
    const announced = new Map<number, number>();
    const timer = setInterval(() => {
      const t = Date.now();
      for (const r of ridersRef.current) {
        const announcedAt = announced.get(r.uid);
        if (r.speaking) {
          if (announcedAt === undefined) {
            WatchBridge.sendEvent({v: PROTOCOL_VERSION, kind: 'event', type: 'speaking', uid: r.uid, from: r.name, active: true});
          }
          announced.set(r.uid, t);
        } else if (announcedAt !== undefined && t - announcedAt > SPEAKING_END_MS) {
          announced.delete(r.uid);
          WatchBridge.sendEvent({v: PROTOCOL_VERSION, kind: 'event', type: 'speaking', uid: r.uid, from: r.name, active: false});
        }
      }
    }, 250);
    return () => clearInterval(timer);
  }, [connected]);

  // Record remote speech while in watch mode. Polled because the pilot list
  // only re-renders when a volume bucket changes, not while someone keeps talking.
  useEffect(() => {
    if (!watchMode) {
      if (recordingRef.current) stopRecording();
      return;
    }
    const timer = setInterval(() => {
      // A phone memo owns Agora's single file recorder (it stopped ours when it
      // started): send what we had and wait until it is done.
      if (isMemoCapture()) {
        if (recordingRef.current) stopRecording(true);
        return;
      }
      const engine = getEngine();
      const t = Date.now();
      const speaking = ridersRef.current.filter(r => r.speaking).map(r => r.uid);
      const rec = recordingRef.current;

      if (rec) {
        if (speaking.length > 0) {
          rec.lastVoiceAt = t;
          speaking.forEach(uid => rec.uids.add(uid));
        }
        if (t - rec.lastVoiceAt > CLIP_SILENCE_MS || t - rec.startedAt > CLIP_MAX_MS) {
          stopRecording();
        }
        return;
      }

      if (!engine || !clipDirRef.current || speaking.length === 0) return;
      const path = `${clipDirRef.current}/rx-${t}.aac`;
      const ret = engine.startAudioRecording({
        filePath: path,
        encode: true,
        sampleRate: 16000,
        fileRecordingType: AudioFileRecordingType.AudioFileRecordingPlayback,
        quality: AudioRecordingQualityType.AudioRecordingQualityLow,
        recordingChannel: 1,
      });
      if (ret !== 0) {
        appLog('Watch', `startAudioRecording failed ret=${ret}`);
        return;
      }
      recordingRef.current = {path, startedAt: t, lastVoiceAt: t, uids: new Set(speaking)};
    }, 250);
    return () => clearInterval(timer);
  }, [watchMode, getEngine, stopRecording, isMemoCapture]);

  useEffect(() => {
    if (!connected) {
      recordingRef.current = null;
      setPhonePtt(false);
    }
  }, [connected]);

  const value = useMemo(
    () => ({
      available: WatchBridge.available, watches, watchMode, voiceWatch: voiceWatchActive, setting, setSetting, pttMode, phonePtt,
    }),
    [watches, watchMode, voiceWatchActive, setting, setSetting, pttMode, phonePtt],
  );

  return <WatchContext.Provider value={value}>{children}</WatchContext.Provider>;
}

export function useWatch(): WatchContextValue {
  const ctx = useContext(WatchContext);
  if (!ctx) throw new Error('useWatch must be used within a WatchProvider');
  return ctx;
}
```

- [ ] **Step 2: Check**

Run: `npx tsc --noEmit && npx eslint src --quiet && npx jest --maxWorkers=1 2>&1 | tail -4`
Expected: no output from tsc / eslint; all suites pass. (Until Task 14, watch clips are not sent anywhere: do not ship between Task 13 and Task 14.)

- [ ] **Step 3: Commit**

```bash
git add src/contexts/WatchContext.tsx
git commit -m "refactor(watch): voice clips leave WatchContext; recorder yields to phone memos"
```

---

### Task 14: MemoContext

**Files:**
- Create: `src/contexts/MemoContext.tsx`
- Modify: `App.tsx` (provider), `jest.setup.js` (Agora mock)

- [ ] **Step 1: Write `src/contexts/MemoContext.tsx`**

```tsx
// Voice memos. Recorded on this phone (MEMO button) or on the watch, sent to
// the group (`to: 0`) or to one rider over the Agora data stream
// (src/ride/voiceClips.ts). Received memos play on this phone (not in watch
// mode: the phone is in a pouch), go to an active Apple Watch / Wear OS watch
// and into the history (RideContext messages, replayable).

import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode} from 'react';
import {Vibration} from 'react-native';
import Sound from 'react-native-sound';
import {AudioFileRecordingType, AudioMixingStateType, AudioRecordingQualityType} from 'react-native-agora';
import {useAgoraContext} from './AgoraContext';
import {HistoryClip, useRide} from './RideContext';
import {useWatch} from './WatchContext';
import {WatchBridge} from '../services/WatchBridge';
import {PROTOCOL_VERSION} from '../ride/protocol';
import {
  CHUNK_INTERVAL_MS,
  ClipAssembler,
  GROUP_UID,
  MAX_CLIP_CHARS,
  isClipForMe,
  parseVoiceChunk,
  splitClip,
} from '../ride/voiceClips';
import {DEMO_RIDERS, demoRider, isDemoUid} from '../ride/demo';
import {
  MEMO_MAX_MS,
  MEMO_MIN_MS,
  memoDurationMs,
  memoRecipient,
  memoSecondsLeft,
  memoSummary,
  newClipId,
} from '../memo/memo';
import {appLog} from '../utils/logger';

/** Demo mode: a virtual rider answers a memo after this long. */
const DEMO_ECHO_DELAY_MS = 2000;
/** Let Agora finish writing the memo file before reading it. */
const FILE_SETTLE_MS = 400;

interface MemoContextValue {
  /** The phone is recording a memo. */
  recording: boolean;
  /** Seconds left before the memo goes to the group by itself. */
  secondsLeft: number;
  /** A memo can be recorded (in a channel). */
  canRecord: boolean;
  startMemo: () => void;
  /** Stop and send: to the group without an argument, else to that rider. */
  sendMemo: (toUid?: number) => void;
  /** Play a memo of the history again. */
  replay: (clip: HistoryClip) => void;
}

const MemoContext = createContext<MemoContextValue | null>(null);

/** Plays a file outside Agora (no channel, or Agora could not open it). */
function playWithSound(path: string, done: () => void) {
  const sound: Sound = new Sound(path, '', err => {
    if (err) {
      appLog('Memo', `cannot play ${path}: ${String(err)}`);
      done();
      return;
    }
    sound.play(() => {
      sound.release();
      done();
    });
  });
}

export function MemoProvider({children}: {children: ReactNode}) {
  const {connectionState, getEngine, sendStreamJson, subscribeStream, localUid, setMemoCapture} = useAgoraContext();
  const {riders, logMessage, demo} = useRide();
  const {watchMode, voiceWatch} = useWatch();
  const connected = connectionState === 'connected';

  // Latest values for callbacks fired by native events and timers
  const live = useRef({connected, demo, watchMode, voiceWatch, localUid, names: new Map<number, string>()});
  live.current = {connected, demo, watchMode, voiceWatch, localUid, names: new Map(riders.map(r => [r.uid, r.name]))};

  const nameOf = useCallback(
    (uid: number) => live.current.names.get(uid) ?? demoRider(uid)?.name ?? 'A rider',
    [],
  );

  // ---- Playback on this phone ----------------------------------------------
  const queueRef = useRef<HistoryClip[]>([]);
  const playingRef = useRef(false);
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPathRef = useRef<string | null>(null);

  const playNext = useCallback(async () => {
    if (fallbackRef.current) {
      clearTimeout(fallbackRef.current);
      fallbackRef.current = null;
    }
    const clip = queueRef.current.shift();
    if (!clip) {
      playingRef.current = false;
      currentPathRef.current = null;
      return;
    }
    playingRef.current = true;
    // A fresh file per playback: sendClip deletes the files it forwards
    const path = await WatchBridge.writeClip(clip.base64, clip.ext);
    if (!path) {
      appLog('Memo', 'cannot write the memo for playback');
      playNext();
      return;
    }
    currentPathRef.current = path;
    const engine = getEngine();
    if (engine && live.current.connected) {
      // Loopback: heard on this phone only, not sent to the channel
      const ret = engine.startAudioMixing(path, true, 1);
      appLog('Memo', `play ${path} (${clip.durationMs} ms) ret=${ret}`);
      if (ret === 0) {
        // Never get stuck if the mixing-finished callback does not come
        fallbackRef.current = setTimeout(playNext, Math.max(clip.durationMs, 1000) + 2000);
        return;
      }
    }
    playWithSound(path, playNext);
  }, [getEngine]);

  useEffect(() => {
    const engine = getEngine();
    if (!engine || !connected) return;
    const onMixing = (state: AudioMixingStateType) => {
      if (!playingRef.current) return;
      if (state === AudioMixingStateType.AudioMixingStateStopped) {
        playNext();
      } else if (state === AudioMixingStateType.AudioMixingStateFailed) {
        // Agora could not open the file: same file, plain player
        if (fallbackRef.current) clearTimeout(fallbackRef.current);
        fallbackRef.current = null;
        const path = currentPathRef.current;
        if (path) playWithSound(path, playNext);
        else playNext();
      }
    };
    engine.addListener('onAudioMixingStateChanged', onMixing);
    return () => engine.removeListener('onAudioMixingStateChanged', onMixing);
  }, [connected, getEngine, playNext]);

  const play = useCallback((clip: HistoryClip) => {
    queueRef.current.push(clip);
    if (!playingRef.current) playNext();
  }, [playNext]);

  // ---- Receiving ------------------------------------------------------------
  const deliver = useCallback(async (fromUid: number, clip: HistoryClip, isPrivate: boolean) => {
    const from = nameOf(fromUid);
    logMessage(from, 'voice', isPrivate ? `${memoSummary(clip.durationMs)} · for you` : memoSummary(clip.durationMs), fromUid, clip);
    Vibration.vibrate(200);
    if (live.current.voiceWatch) {
      const path = await WatchBridge.writeClip(clip.base64, clip.ext);
      if (path) {
        WatchBridge.sendClip(path, {
          v: PROTOCOL_VERSION, kind: 'clip', uid: fromUid, from, durationMs: clip.durationMs, private: isPrivate,
        });
      }
    }
    // Decision 3: in watch mode the phone sits in a pouch, the watch plays it
    if (!live.current.watchMode) play(clip);
  }, [logMessage, nameOf, play]);

  const assemblerRef = useRef(new ClipAssembler());

  useEffect(() => {
    return subscribeStream((fromUid, raw) => {
      if (raw.type !== 'vc') return;
      const chunk = parseVoiceChunk(raw);
      if (!chunk || !isClipForMe(chunk.to, live.current.localUid)) return;
      const clip = assemblerRef.current.add(fromUid, chunk, Date.now());
      if (!clip) return;
      deliver(fromUid, {base64: clip.base64, ext: clip.ext, durationMs: clip.durationMs}, chunk.to !== GROUP_UID);
    });
  }, [subscribeStream, deliver]);

  // ---- Demo: the virtual rider sends the memo back --------------------------
  const echoDemo = useCallback((clip: HistoryClip, to: number) => {
    const rider = demoRider(to) ?? DEMO_RIDERS[0];
    const meta = {uid: rider.uid, from: rider.name};
    setTimeout(() => {
      if (!live.current.demo) return;
      WatchBridge.sendEvent({v: PROTOCOL_VERSION, kind: 'event', type: 'speaking', ...meta, active: true});
      deliver(rider.uid, clip, to !== GROUP_UID);
      setTimeout(() => {
        WatchBridge.sendEvent({v: PROTOCOL_VERSION, kind: 'event', type: 'speaking', ...meta, active: false});
      }, Math.max(clip.durationMs, 1000));
    }, DEMO_ECHO_DELAY_MS);
  }, [deliver]);

  // ---- Sending ----------------------------------------------------------------
  /** Sends a memo (or echoes it in demo mode). False when it could not go. */
  const transmit = useCallback((clip: HistoryClip, to: number): boolean => {
    const who = to === GROUP_UID ? 'To group' : `To ${nameOf(to)}`;
    // Demo: memos to a virtual rider, or any memo without a real channel
    if (live.current.demo && (isDemoUid(to) || !live.current.connected)) {
      logMessage(who, 'voice', memoSummary(clip.durationMs), null, clip);
      echoDemo(clip, to);
      return true;
    }
    if (clip.base64.length > MAX_CLIP_CHARS) {
      logMessage('You', 'voice', 'Voice memo too long, not sent');
      return false;
    }
    if (!live.current.connected) {
      logMessage('You', 'voice', 'Voice memo not sent: not connected');
      return false;
    }
    const chunks = splitClip(clip.base64, newClipId(Date.now()), to, clip.durationMs, clip.ext);
    chunks.forEach((chunk, i) => {
      setTimeout(() => sendStreamJson(chunk), i * CHUNK_INTERVAL_MS);
    });
    appLog('Memo', `sending ${chunks.length} slices to ${to === GROUP_UID ? 'the group' : to}`);
    logMessage(who, 'voice', memoSummary(clip.durationMs), null, clip);
    return true;
  }, [echoDemo, logMessage, nameOf, sendStreamJson]);

  // Memos recorded on the watch: `to` absent, null or 0 = the group
  useEffect(() => {
    const sub = WatchBridge.onClip(async ({platform, path, durationMs, to}) => {
      appLog('Memo', `watch clip from ${platform}: ${durationMs} ms${typeof to === 'number' ? ` to ${to}` : ''}`);
      const base64 = await WatchBridge.readClipBase64(path);
      if (!base64) {
        logMessage('You', 'voice', 'Voice memo from the watch could not be read');
        return;
      }
      const ext = path.split('.').pop()?.toLowerCase() || 'm4a';
      transmit({base64, ext, durationMs}, memoRecipient(to));
    });
    return () => sub?.remove();
  }, [logMessage, transmit]);

  // ---- Recording on this phone --------------------------------------------
  const [recording, setRecording] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(MEMO_MAX_MS / 1000);
  const recRef = useRef<{path: string; startedAt: number} | null>(null);
  const clipDirRef = useRef<string | null>(null);

  useEffect(() => {
    WatchBridge.getClipDir().then(dir => {
      clipDirRef.current = dir;
    });
  }, []);

  const stopRecorder = useCallback((): {path: string; durationMs: number} | null => {
    const rec = recRef.current;
    recRef.current = null;
    setRecording(false);
    if (!rec) return null;
    getEngine()?.stopAudioRecording();
    setMemoCapture(false);
    return {path: rec.path, durationMs: memoDurationMs(rec.startedAt, Date.now())};
  }, [getEngine, setMemoCapture]);

  const sendMemo = useCallback((toUid?: number) => {
    const done = stopRecorder();
    if (!done) return;
    const to = memoRecipient(toUid);
    if (done.durationMs < MEMO_MIN_MS) {
      logMessage('You', 'voice', 'Voice memo too short, not sent');
      return;
    }
    Vibration.vibrate(50);
    setTimeout(async () => {
      const base64 = await WatchBridge.readClipBase64(done.path);
      if (!base64) {
        appLog('Memo', `no recording at ${done.path}`);
        logMessage('You', 'voice', 'Voice memo failed: nothing was recorded');
        return;
      }
      transmit({base64, ext: 'aac', durationMs: done.durationMs}, to);
    }, FILE_SETTLE_MS);
  }, [logMessage, stopRecorder, transmit]);

  const startMemo = useCallback(() => {
    const engine = getEngine();
    const dir = clipDirRef.current;
    if (recRef.current || !engine || !live.current.connected) return;
    if (!dir) {
      logMessage('You', 'voice', 'Voice memo failed: no folder to record into');
      return;
    }
    // Agora has one file recorder: take it from the watch's remote-speech clip
    engine.stopAudioRecording();
    setMemoCapture(true);
    const path = `${dir}/memo-${Date.now()}.aac`;
    const ret = engine.startAudioRecording({
      filePath: path,
      encode: true,
      sampleRate: 16000,
      fileRecordingType: AudioFileRecordingType.AudioFileRecordingMic,
      quality: AudioRecordingQualityType.AudioRecordingQualityLow,
      recordingChannel: 1,
    });
    if (ret !== 0) {
      setMemoCapture(false);
      appLog('Memo', `startAudioRecording(mic) failed ret=${ret}`);
      logMessage('You', 'voice', 'Voice memo failed: microphone not available');
      Vibration.vibrate([0, 100, 100, 100]);
      return;
    }
    recRef.current = {path, startedAt: Date.now()};
    setSecondsLeft(MEMO_MAX_MS / 1000);
    setRecording(true);
    Vibration.vibrate(50);
  }, [getEngine, logMessage, setMemoCapture]);

  // Countdown; at 30 s the memo goes to the group by itself
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const rec = recRef.current;
      if (!rec) return;
      const left = memoSecondsLeft(rec.startedAt, Date.now());
      setSecondsLeft(left);
      if (left === 0) sendMemo();
    }, 250);
    return () => clearInterval(timer);
  }, [recording, sendMemo]);

  // Leaving the channel ends a recording without sending it
  useEffect(() => {
    if (connected) return;
    if (recRef.current) stopRecorder();
  }, [connected, stopRecorder]);

  const value = useMemo(
    () => ({recording, secondsLeft, canRecord: connected, startMemo, sendMemo, replay: play}),
    [recording, secondsLeft, connected, startMemo, sendMemo, play],
  );

  return <MemoContext.Provider value={value}>{children}</MemoContext.Provider>;
}

export function useMemos(): MemoContextValue {
  const ctx = useContext(MemoContext);
  if (!ctx) throw new Error('useMemos must be used within a MemoProvider');
  return ctx;
}
```

- [ ] **Step 2: Mount the provider**

In `App.tsx`, add `import {MemoProvider} from './src/contexts/MemoContext';` after the `WatchProvider` import, and wrap `<AppContent />`:

```tsx
            <WatchProvider>
              <MemoProvider>
                <AppContent />
              </MemoProvider>
            </WatchProvider>
```

- [ ] **Step 3: Agora mock knows the mic recording type**

In `jest.setup.js`, replace `AudioFileRecordingType: {AudioFileRecordingPlayback: 2},` with:

```js
  AudioFileRecordingType: {AudioFileRecordingMic: 1, AudioFileRecordingPlayback: 2},
```

- [ ] **Step 4: Check**

Run: `npx tsc --noEmit && npx eslint src --quiet && npx jest --maxWorkers=1 2>&1 | tail -4`
Expected: no output from tsc / eslint; all suites pass (including `__tests__/App.test.tsx`, which mounts the provider).

- [ ] **Step 5: Commit**

```bash
git add src/contexts/MemoContext.tsx App.tsx jest.setup.js
git commit -m "feat(memo): phone and watch memos to the group or one rider, playback and forwarding"
```

---

### Task 15: MSG sheet

**Files:**
- Create: `src/components/signal/MsgSheet.tsx`

- [ ] **Step 1: Write the component**

```tsx
import React from 'react';
import {Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, Vibration, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAgoraContext} from '../../contexts/AgoraContext';
import {RideMessage, useRide} from '../../contexts/RideContext';
import {useMemos} from '../../contexts/MemoContext';
import {QUICK_MESSAGES} from '../../ride/protocol';
import {historyTitle} from '../../memo/memo';
import {condensed, plain, signal} from '../../theme';

interface MsgSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Leaves the channel (after the confirmation here). */
  onLeave: () => void;
}

/** Quick messages, history with replay, speaker, video pause, leave. */
export function MsgSheet({visible, onClose, onLeave}: MsgSheetProps) {
  const insets = useSafeAreaInsets();
  const {isSpeakerOn, toggleSpeaker, isHeadphonesConnected, isPausedForVideo, pauseForVideo, resumeFromVideo} = useAgoraContext();
  const {messages, sendQuickMessage} = useRide();
  const {replay} = useMemos();
  const newestVoiceKey = messages.find(m => m.clip !== undefined)?.key;

  const confirmLeave = () => {
    Alert.alert('Leave group', 'Are you sure you want to leave this group?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => {
          onClose();
          onLeave();
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} accessibilityLabel="Close messages" />
        <View style={[styles.panel, {paddingBottom: Math.max(insets.bottom, 16)}]}>
          <View style={styles.grabber} />
          <Text style={styles.overline}>QUICK MESSAGES</Text>
          <View style={styles.quick}>
            {QUICK_MESSAGES.map(q => (
              <TouchableOpacity
                key={q.id}
                style={styles.quickPill}
                activeOpacity={0.7}
                onPress={() => {
                  Vibration.vibrate(30);
                  sendQuickMessage(q.id);
                  onClose();
                }}>
                <Text style={[styles.quickText, q.id === 'help' && styles.quickHelp]} numberOfLines={1} adjustsFontSizeToFit>
                  {q.text}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.overline}>HISTORY</Text>
          <ScrollView style={styles.history}>
            {messages.length === 0 && <Text style={styles.empty}>Nothing yet. Messages, SOS and voice memos show here.</Text>}
            {messages.map(m => {
              const clip = m.clip;
              return (
                <HistoryRow
                  key={m.key}
                  message={m}
                  highlighted={m.key === newestVoiceKey}
                  onReplay={clip ? () => replay(clip) : undefined}
                />
              );
            })}
          </ScrollView>

          <View style={styles.actions}>
            {isHeadphonesConnected ? (
              <View style={styles.action}>
                <Text style={[styles.actionText, styles.actionTeal]}>EARPHONE</Text>
              </View>
            ) : (
              <TouchableOpacity style={[styles.action, isSpeakerOn && styles.actionOn]} onPress={toggleSpeaker}>
                <Text style={[styles.actionText, isSpeakerOn && styles.actionTextOn]}>{isSpeakerOn ? 'SPEAKER ON' : 'SPEAKER OFF'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.action} onPress={isPausedForVideo ? resumeFromVideo : pauseForVideo}>
              <Text style={styles.actionText}>{isPausedForVideo ? 'RESUME AUDIO' : 'PAUSE FOR VIDEO'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.leave} onPress={confirmLeave}>
            <Text style={styles.leaveText}>Leave group</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function HistoryRow({message, highlighted, onReplay}: {message: RideMessage; highlighted: boolean; onReplay?: () => void}) {
  const voice = message.clip !== undefined;
  const sos = message.id === 'sos';
  const body = (
    <>
      <View style={[styles.marker, voice ? styles.markerVoice : sos ? styles.markerSos : styles.markerText]} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {historyTitle(message.from, message.t)}
        </Text>
        <Text style={[styles.rowBody, voice && styles.rowBodyVoice]} numberOfLines={2}>
          {message.text}
        </Text>
      </View>
      {voice && <Text style={styles.play}>PLAY</Text>}
    </>
  );
  if (!onReplay) return <View style={styles.row}>{body}</View>;
  return (
    <TouchableOpacity
      style={[styles.row, highlighted && styles.rowHighlight]}
      onPress={onReplay}
      accessibilityLabel={`Play the voice memo from ${message.from} again`}>
      {body}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  panel: {
    maxHeight: '90%',
    backgroundColor: signal.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 10,
    paddingHorizontal: 18,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: signal.outline,
    marginBottom: 12,
  },
  overline: {
    color: signal.textMuted,
    marginTop: 6,
    marginBottom: 8,
    ...condensed(12, 700, 2),
  },
  quick: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickPill: {
    width: '48.5%',
    minHeight: 56,
    borderRadius: 28,
    backgroundColor: signal.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  quickText: {
    color: signal.text,
    ...condensed(18, 800, 1),
  },
  quickHelp: {
    color: signal.amber,
  },
  history: {
    flexGrow: 0,
    maxHeight: 280,
  },
  empty: {
    color: signal.textMuted,
    paddingVertical: 12,
    ...plain(14, 600),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderRadius: 12,
  },
  rowHighlight: {
    backgroundColor: signal.surfaceAlt,
  },
  marker: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  markerVoice: {
    backgroundColor: signal.yellow,
  },
  markerSos: {
    backgroundColor: signal.red,
  },
  markerText: {
    borderWidth: 2,
    borderColor: signal.teal,
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    color: signal.text,
    ...condensed(14, 700),
  },
  rowBody: {
    color: signal.text,
    ...plain(13, 600),
  },
  rowBodyVoice: {
    color: signal.textMuted,
  },
  play: {
    color: signal.yellow,
    ...condensed(13, 800, 1),
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  action: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: signal.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionOn: {
    backgroundColor: signal.teal,
    borderColor: signal.teal,
  },
  actionText: {
    color: signal.textMuted,
    ...condensed(14, 700, 1),
  },
  actionTextOn: {
    color: signal.onAccent,
  },
  actionTeal: {
    color: signal.teal,
  },
  leave: {
    alignSelf: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginTop: 4,
  },
  leaveText: {
    color: signal.red,
    ...plain(15, 700),
  },
});
```

- [ ] **Step 2: Check**

Run: `npx tsc --noEmit && npx eslint src --quiet`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/signal/MsgSheet.tsx
git commit -m "feat(phone): MSG sheet with quick messages, history replay and leave"
```

---

### Task 16: Join screen

**Files:**
- Create: `src/screens/JoinScreen.tsx`

Keeps from `HomeScreen.tsx`: `FAVORITES_KEY = '@soarx_favorite_channels'`, `DEFAULT_CHANNEL = 'TARIFA-01'`, `canJoin`, `isValidChannelName`, `generateChannelName`, `toggleFavorite`, the microphone / notification permission request and the join error alert, the demo hint.

- [ ] **Step 1: Write `src/screens/JoinScreen.tsx`**

```tsx
import React, {useCallback, useEffect, useState} from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useUser} from '../contexts/UserContext';
import {useAgoraContext} from '../contexts/AgoraContext';
import {useRide} from '../contexts/RideContext';
import {generateChannelName, isValidChannelName, splitChannelCode} from '../utils/channelGenerator';
import {appLog} from '../utils/logger';
import {condensed, plain, signal} from '../theme';

const FAVORITES_KEY = '@soarx_favorite_channels';
const DEFAULT_CHANNEL = 'TARIFA-01';
/** Ring diameters of the hero at full size (handoff: 330 / 230 / 130, inner one teal). */
const RINGS = [330, 230, 130];
const HERO_HEIGHT = 400;
/** Favourite pills on the screen; the rest are in EDIT. */
const VISIBLE_FAVORITES = 3;

interface JoinScreenProps {
  onJoined: () => void;
  onSettings: () => void;
}

async function requestMicPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
    title: 'Microphone Permission',
    message: 'ComX needs microphone access to talk with your group.',
    buttonPositive: 'Allow',
  });
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) return false;
  // Android 13+ suppresses the foreground-service notification without this.
  // Not being able to show it is not a reason to block the ride.
  if (Number(Platform.Version) >= 33) {
    try {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS, {
        title: 'Notifications',
        message: 'Lets ComX show the group status while you ride.',
        buttonPositive: 'Allow',
      });
    } catch {}
  }
  return true;
}

export function JoinScreen({onJoined, onSettings}: JoinScreenProps) {
  const {pilotName, setPilotName} = useUser();
  const {joinChannel} = useAgoraContext();
  const {demo} = useRide();
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();
  const [channel, setChannel] = useState(DEFAULT_CHANNEL);
  const [editingChannel, setEditingChannel] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [managing, setManaging] = useState(false);

  const validChannel = isValidChannelName(channel);
  const canJoin = pilotName.trim().length > 0 && validChannel;
  // Smaller phones: the rings shrink with the screen, the type does not
  const scale = Math.min(1, (width - 40) / RINGS[0], (height * 0.45) / HERO_HEIGHT);
  const {head, tail} = splitChannelCode(channel);

  useEffect(() => {
    AsyncStorage.getItem(FAVORITES_KEY).then(saved => {
      if (saved) setFavorites(JSON.parse(saved));
    });
  }, []);

  const saveFavorites = useCallback((next: string[]) => {
    setFavorites(next);
    AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  }, []);

  const isFavorite = favorites.includes(channel.trim().toUpperCase());

  const toggleFavorite = useCallback(() => {
    const name = channel.trim().toUpperCase();
    if (!name) return;
    if (favorites.includes(name)) saveFavorites(favorites.filter(f => f !== name));
    else saveFavorites([name, ...favorites]);
  }, [channel, favorites, saveFavorites]);

  const stopEditing = () => {
    Keyboard.dismiss();
    setEditingChannel(false);
    setEditingName(false);
  };

  const handleJoin = async () => {
    if (!canJoin || isJoining) return;
    stopEditing();
    const hasPermission = await requestMicPermission();
    if (!hasPermission) {
      Alert.alert('Permission Required', 'ComX needs microphone access to work. Please enable it in Settings.');
      return;
    }
    setIsJoining(true);
    try {
      await joinChannel({channelName: channel, pilotName});
      onJoined();
    } catch (error) {
      appLog('Join', `failed: ${error instanceof Error ? error.message : String(error)}`);
      Alert.alert('Connection Failed', 'Could not join the channel. Check your network coverage and try again.');
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <TouchableWithoutFeedback onPress={stopEditing} accessible={false}>
      <KeyboardAvoidingView
        style={[styles.container, {paddingTop: insets.top}]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.topBar}>
          <Text style={styles.logo}>COMX</Text>
          <TouchableOpacity onPress={onSettings} hitSlop={12}>
            <Text style={styles.settings}>Settings</Text>
          </TouchableOpacity>
        </View>

        {demo && (
          <TouchableOpacity onPress={onSettings} activeOpacity={0.7}>
            <Text style={styles.demo}>Demo riders on: open ComX on your watch. Turn off in Settings.</Text>
          </TouchableOpacity>
        )}

        <View style={[styles.hero, {height: HERO_HEIGHT * scale}]}>
          {RINGS.map((d, i) => (
            <View
              key={d}
              style={[
                styles.ring,
                {
                  width: d * scale,
                  height: d * scale,
                  borderRadius: (d * scale) / 2,
                  borderColor: i === RINGS.length - 1 ? signal.teal : signal.ring,
                },
              ]}
            />
          ))}
          <View style={styles.heroCentre}>
            <Text style={styles.overline}>CHANNEL</Text>
            {editingChannel ? (
              <TextInput
                style={styles.channelInput}
                value={channel}
                onChangeText={t => setChannel(t.toUpperCase().replace(/\s/g, ''))}
                autoCapitalize="characters"
                autoCorrect={false}
                autoFocus
                maxLength={30}
                returnKeyType="done"
                onSubmitEditing={() => setEditingChannel(false)}
                onBlur={() => setEditingChannel(false)}
                selectionColor={signal.teal}
              />
            ) : (
              <TouchableOpacity onPress={() => setEditingChannel(true)} accessibilityLabel={`Channel ${channel}, tap to edit`}>
                <Text style={styles.channel} numberOfLines={1} adjustsFontSizeToFit>
                  {head || ' '}
                </Text>
                {tail !== '' && <Text style={[styles.channel, styles.channelTail]}>{tail}</Text>}
              </TouchableOpacity>
            )}
            {!validChannel && <Text style={styles.invalid}>Letters, digits and "-" only, 30 at most</Text>}
          </View>
        </View>

        <View style={styles.favorites}>
          {favorites.slice(0, VISIBLE_FAVORITES).map(f => (
            <TouchableOpacity key={f} style={styles.pill} onPress={() => setChannel(f)}>
              <Text style={[styles.pillText, f === channel && styles.pillActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.ghostPill} onPress={() => setManaging(true)} accessibilityLabel="Edit favourite channels">
            <Text style={styles.ghostText}>EDIT</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.spacer} />

        {editingName ? (
          <TextInput
            style={styles.nameInput}
            value={pilotName}
            onChangeText={setPilotName}
            placeholder="Your name"
            placeholderTextColor={signal.textDim}
            autoCapitalize="words"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => setEditingName(false)}
            onBlur={() => setEditingName(false)}
            selectionColor={signal.teal}
          />
        ) : (
          <TouchableOpacity onPress={() => setEditingName(true)} accessibilityLabel="Your name, tap to edit">
            <Text style={styles.ridingAs}>
              Riding as <Text style={styles.name}>{pilotName.trim() || 'tap to set your name'}</Text>
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.join, {marginBottom: Math.max(36, insets.bottom + 12)}, !canJoin && styles.joinDisabled]}
          onPress={handleJoin}
          disabled={!canJoin || isJoining}
          activeOpacity={0.8}>
          <Text style={styles.joinText}>{isJoining ? 'CONNECTING…' : 'JOIN'}</Text>
        </TouchableOpacity>

        <Modal visible={managing} transparent animationType="slide" onRequestClose={() => setManaging(false)}>
          <View style={styles.modalRoot}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setManaging(false)} />
            <View style={[styles.manage, {paddingBottom: insets.bottom + 20}]}>
              <Text style={styles.manageTitle}>FAVOURITES</Text>
              <TouchableOpacity style={styles.manageRow} onPress={toggleFavorite} disabled={!validChannel}>
                <Text style={[styles.manageAction, !validChannel && styles.manageDisabled]}>
                  {isFavorite ? `REMOVE ${channel}` : `SAVE ${channel}`}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.manageRow} onPress={() => setChannel(generateChannelName())}>
                <Text style={styles.manageAction}>RANDOM CHANNEL</Text>
              </TouchableOpacity>
              <ScrollView style={styles.manageList}>
                {favorites.map(f => (
                  <View key={f} style={styles.manageRow}>
                    <TouchableOpacity
                      style={styles.manageName}
                      onPress={() => {
                        setChannel(f);
                        setManaging(false);
                      }}>
                      <Text style={styles.manageNameText}>{f}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => saveFavorites(favorites.filter(x => x !== f))} hitSlop={10}>
                      <Text style={styles.remove}>REMOVE</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
              <TouchableOpacity style={styles.done} onPress={() => setManaging(false)}>
                <Text style={styles.doneText}>DONE</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: signal.bg,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  logo: {
    color: signal.text,
    ...condensed(16, 700, 3),
  },
  settings: {
    color: signal.textMuted,
    ...plain(14, 600),
  },
  demo: {
    color: signal.teal,
    textAlign: 'center',
    paddingHorizontal: 24,
    marginTop: 8,
    ...plain(13, 600),
  },
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
  },
  heroCentre: {
    alignItems: 'center',
    maxWidth: 220,
  },
  overline: {
    color: signal.teal,
    ...condensed(12, 600, 3),
  },
  channel: {
    color: signal.text,
    textAlign: 'center',
    lineHeight: 42,
    ...condensed(40, 800),
  },
  channelTail: {
    color: signal.teal,
  },
  channelInput: {
    color: signal.text,
    textAlign: 'center',
    minWidth: 200,
    borderBottomWidth: 2,
    borderBottomColor: signal.teal,
    paddingVertical: 4,
    ...condensed(34, 800),
  },
  invalid: {
    color: signal.red,
    marginTop: 6,
    textAlign: 'center',
    ...plain(12, 600),
  },
  favorites: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
  pill: {
    backgroundColor: signal.surfaceAlt,
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  pillText: {
    color: signal.text,
    ...condensed(15, 700, 1),
  },
  pillActive: {
    color: signal.teal,
  },
  ghostPill: {
    borderWidth: 1.5,
    borderColor: signal.outline,
    borderRadius: 18,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  ghostText: {
    color: signal.textMuted,
    ...condensed(15, 700, 1),
  },
  spacer: {
    flex: 1,
  },
  ridingAs: {
    color: signal.textMuted,
    textAlign: 'center',
    paddingBottom: 12,
    ...plain(14, 600),
  },
  name: {
    color: signal.text,
  },
  nameInput: {
    color: signal.text,
    textAlign: 'center',
    marginHorizontal: 60,
    marginBottom: 12,
    paddingVertical: 6,
    borderBottomWidth: 2,
    borderBottomColor: signal.teal,
    ...plain(16, 600),
  },
  join: {
    marginHorizontal: 20,
    height: 72,
    borderRadius: 36,
    backgroundColor: signal.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinDisabled: {
    opacity: 0.35,
  },
  joinText: {
    color: signal.onAccent,
    ...condensed(26, 800, 2),
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  manage: {
    maxHeight: '80%',
    backgroundColor: signal.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 18,
    paddingHorizontal: 20,
  },
  manageTitle: {
    color: signal.textMuted,
    marginBottom: 6,
    ...condensed(12, 700, 2),
  },
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: signal.surfaceAlt,
  },
  manageAction: {
    color: signal.teal,
    ...condensed(18, 800, 1),
  },
  manageDisabled: {
    opacity: 0.35,
  },
  manageList: {
    flexGrow: 0,
  },
  manageName: {
    flex: 1,
  },
  manageNameText: {
    color: signal.text,
    ...condensed(18, 800, 1),
  },
  remove: {
    color: signal.red,
    ...condensed(14, 700, 1),
  },
  done: {
    alignSelf: 'center',
    paddingVertical: 16,
    paddingHorizontal: 30,
  },
  doneText: {
    color: signal.text,
    ...condensed(16, 800, 2),
  },
});
```

- [ ] **Step 2: Check**

Run: `npx tsc --noEmit && npx eslint src --quiet`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/screens/JoinScreen.tsx
git commit -m "feat(phone): Signal join screen"
```

---

### Task 17: Live screen

**Files:**
- Create: `src/screens/LiveScreen.tsx`

Keeps from `VoiceScreen.tsx`: the inactivity sound / vibration effect, auto-navigation home on `autoDisconnected`, `useMute` + `useBluetoothHID(toggle)`, the banner texts, the watch-mode / Garmin states.

- [ ] **Step 1: Write `src/screens/LiveScreen.tsx`**

```tsx
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Platform, StyleSheet, Text, TouchableOpacity, Vibration, View, useWindowDimensions} from 'react-native';
import Sound from 'react-native-sound';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAgoraContext} from '../contexts/AgoraContext';
import {useRide} from '../contexts/RideContext';
import {useWatch} from '../contexts/WatchContext';
import {useMemos} from '../contexts/MemoContext';
import {useMute} from '../hooks/useMute';
import {useBluetoothHID} from '../hooks/useBluetoothHID';
import {soundFile} from '../utils/sounds';
import {ArrowMode, arrowHeading} from '../radar/radar';
import {sheetDetents} from '../radar/sheet';
import {RadarView} from '../components/signal/RadarView';
import {RiderRow} from '../components/signal/RiderRow';
import {BottomSheet} from '../components/signal/BottomSheet';
import {ControlRow, TalkState} from '../components/signal/ControlRow';
import {Banner} from '../components/signal/Banner';
import {MsgSheet} from '../components/signal/MsgSheet';
import {condensed, plain, signal} from '../theme';

interface LiveScreenProps {
  onLeft: () => void;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function LiveScreen({onLeft}: LiveScreenProps) {
  const {width, height} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const {
    channelName, leaveChannel, connectionState, inactivityWarning, warningSecondsLeft, dismissWarning,
    autoDisconnected, isInterrupted,
  } = useAgoraContext();
  const {isMuted, toggle} = useMute();
  useBluetoothHID(toggle);
  const {riders, myPosition, mySos, setSos, locationDenied} = useRide();
  const watch = useWatch();
  const memo = useMemos();
  const [arrowMode, setArrowMode] = useState<ArrowMode>('north');
  const [msgOpen, setMsgOpen] = useState(false);
  const audioPlayedRef = useRef(false);

  const heading = arrowHeading(arrowMode, myPosition?.cog);
  const bottomPad = Math.max(insets.bottom, 16);
  const detents = useMemo(() => sheetDetents(height, bottomPad), [height, bottomPad]);
  // The radar fills what the sheet leaves at rest, a little under its rounded top
  const radarHeight = height - detents.medium + 28;

  // Audio warning for the silence timeout (unchanged from VoiceScreen)
  useEffect(() => {
    if (inactivityWarning === 'silence' && !audioPlayedRef.current) {
      audioPlayedRef.current = true;
      try {
        Vibration.vibrate(Platform.OS === 'ios' ? 500 : 1000);
      } catch {}
      const warning = new Sound(soundFile('inactivity_warning'), Sound.MAIN_BUNDLE, err => {
        if (!err) warning.play(() => warning.release());
      });
    } else if (inactivityWarning === 'solo') {
      try {
        Vibration.vibrate(Platform.OS === 'ios' ? 500 : 1000);
      } catch {}
    }
    if (!inactivityWarning) {
      audioPlayedRef.current = false;
    }
  }, [inactivityWarning]);

  // Back to Join when auto-disconnected
  useEffect(() => {
    if (autoDisconnected) onLeft();
  }, [autoDisconnected, onLeft]);

  const leave = useCallback(async () => {
    await leaveChannel();
    onLeft();
  }, [leaveChannel, onLeft]);

  const talk: TalkState = watch.watchMode
    ? 'watch'
    : watch.pttMode
      ? watch.phonePtt ? 'garminTalking' : 'garmin'
      : isMuted ? 'muted' : 'live';

  // Decision 7: everyone in the channel, me included
  const count = riders.length + 1;
  const status =
    connectionState === 'reconnecting'
      ? {text: 'RECONNECTING…', color: signal.amber}
      : connectionState === 'failed'
        ? {text: 'CONNECTION LOST', color: signal.red}
        : {text: `● ${count} ${count === 1 ? 'RIDER' : 'RIDERS'}`, color: signal.teal};

  return (
    <View style={styles.container}>
      <View style={styles.radar}>
        <RadarView riders={riders} heading={heading} myCourse={myPosition?.cog ?? null} width={width} height={radarHeight} />
      </View>

      <View style={[styles.topLeft, {top: insets.top + 12}]}>
        <Text style={styles.channel} numberOfLines={1}>
          {channelName}
        </Text>
        <Text style={[styles.status, {color: status.color}]}>{status.text}</Text>
      </View>
      <TouchableOpacity
        style={[styles.topRight, {top: insets.top + 14}]}
        onPress={() => setArrowMode(m => (m === 'north' ? 'course' : 'north'))}
        hitSlop={12}
        accessibilityLabel={arrowMode === 'north' ? 'North up, tap for course up' : 'Course up, tap for north up'}>
        <Text style={styles.arrowMode}>{arrowMode === 'north' ? 'N ↑' : 'COG ↑'}</Text>
      </TouchableOpacity>

      <View style={[styles.banners, {top: insets.top + 64}]} pointerEvents="box-none">
        {memo.recording && (
          <Banner tone="red" text={`Memo to the group · ${memo.secondsLeft} s. Tap a rider to send it to them only.`} />
        )}
        {inactivityWarning && (
          <Banner
            text={
              inactivityWarning === 'solo'
                ? `You're alone. Disconnecting in ${formatCountdown(warningSecondsLeft)}`
                : `No activity. Disconnecting in ${formatCountdown(warningSecondsLeft)}`
            }
            action={{label: 'STAY', onPress: dismissWarning}}
          />
        )}
        {isInterrupted && <Banner text="Call in progress: your mic is paused, you're still in the channel" />}
        {locationDenied && <Banner text="Location is off: others can't see where you are." />}
      </View>

      <BottomSheet
        detents={detents}
        bottomPad={bottomPad}
        footer={
          <ControlRow
            mySos={mySos}
            onSos={setSos}
            talk={talk}
            onTalk={toggle}
            memoRecording={memo.recording}
            memoSecondsLeft={memo.secondsLeft}
            memoEnabled={memo.canRecord}
            onMemo={memo.recording ? () => memo.sendMemo() : memo.startMemo}
            onMsg={() => setMsgOpen(true)}
          />
        }>
        {riders.length === 0 ? (
          <Text style={styles.empty}>No other rider yet. Share the channel code {channelName}.</Text>
        ) : (
          riders.map(r => (
            <RiderRow
              key={r.uid}
              rider={r}
              heading={heading}
              onPress={memo.recording ? () => memo.sendMemo(r.uid) : undefined}
            />
          ))
        )}
      </BottomSheet>

      <MsgSheet visible={msgOpen} onClose={() => setMsgOpen(false)} onLeave={leave} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: signal.bg,
  },
  radar: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  topLeft: {
    position: 'absolute',
    left: 20,
    right: 90,
  },
  channel: {
    color: signal.text,
    lineHeight: 26,
    ...condensed(24, 800),
  },
  status: {
    ...condensed(13, 600, 2),
  },
  topRight: {
    position: 'absolute',
    right: 20,
  },
  arrowMode: {
    color: signal.red,
    ...condensed(13, 700, 2),
  },
  banners: {
    position: 'absolute',
    left: 16,
    right: 16,
    gap: 8,
  },
  empty: {
    color: signal.textMuted,
    textAlign: 'center',
    paddingVertical: 20,
    ...plain(14, 600),
  },
});
```

- [ ] **Step 2: Check**

Run: `npx tsc --noEmit && npx eslint src --quiet`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/screens/LiveScreen.tsx
git commit -m "feat(phone): Signal live screen with radar, sheet and memos"
```

---

### Task 18: Wire the screens, remove the old ones, single palette

**Files:**
- Modify: `App.tsx`, `src/contexts/ThemeContext.tsx`, `src/theme.ts`, `jest.setup.js`
- Delete: `src/screens/HomeScreen.tsx`, `src/screens/VoiceScreen.tsx`, `src/components/PilotList.tsx`, `src/components/MuteButton.tsx`, `src/components/RideBar.tsx`, `src/components/ChannelBadge.tsx`

- [ ] **Step 1: Replace `App.tsx`**

```tsx
import React, {useState} from 'react';
import {StatusBar, View, LogBox} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

// Keep warnings visible in development; only silence them in release builds.
if (!__DEV__) {
  LogBox.ignoreAllLogs();
}
import {UserProvider} from './src/contexts/UserContext';
import {AgoraProvider} from './src/contexts/AgoraContext';
import {RideProvider} from './src/contexts/RideContext';
import {WatchProvider} from './src/contexts/WatchContext';
import {MemoProvider} from './src/contexts/MemoContext';
import {ThemeProvider} from './src/contexts/ThemeContext';
import {JoinScreen} from './src/screens/JoinScreen';
import {LiveScreen} from './src/screens/LiveScreen';
import {SettingsScreen} from './src/screens/SettingsScreen';
import {signal} from './src/theme';

type Screen = 'join' | 'live' | 'settings';

function AppContent() {
  const [screen, setScreen] = useState<Screen>('join');

  return (
    <View style={{flex: 1, backgroundColor: signal.bg}}>
      <StatusBar barStyle="light-content" backgroundColor={signal.bg} />
      {screen === 'join' && (
        <JoinScreen onJoined={() => setScreen('live')} onSettings={() => setScreen('settings')} />
      )}
      {screen === 'live' && <LiveScreen onLeft={() => setScreen('join')} />}
      {screen === 'settings' && <SettingsScreen onDone={() => setScreen('join')} />}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <UserProvider>
          <AgoraProvider>
            <RideProvider>
              <WatchProvider>
                <MemoProvider>
                  <AppContent />
                </MemoProvider>
              </WatchProvider>
            </RideProvider>
          </AgoraProvider>
        </UserProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
```

- [ ] **Step 2: Replace `src/contexts/ThemeContext.tsx` (one palette, no light mode)**

```tsx
// ComX has a single "Signal" palette (src/theme.ts). The provider stays so
// SettingsScreen keeps reading colours through useTheme().

import React, {createContext, useContext, ReactNode} from 'react';
import {colors, ThemeColors} from '../theme';

interface ThemeContextValue {
  colors: ThemeColors;
}

const value: ThemeContextValue = {colors};
const ThemeContext = createContext<ThemeContextValue>(value);

export function ThemeProvider({children}: {children: ReactNode}) {
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
```

In `src/theme.ts`, delete `export type ThemeMode = 'dark' | 'light';` and the whole `getColors` function with its comment.

- [ ] **Step 3: Delete the replaced files**

```bash
git rm src/screens/HomeScreen.tsx src/screens/VoiceScreen.tsx \
  src/components/PilotList.tsx src/components/MuteButton.tsx src/components/RideBar.tsx src/components/ChannelBadge.tsx
grep -rn "PilotList\|MuteButton\|RideBar\|ChannelBadge\|HomeScreen\|VoiceScreen\|getColors\|ThemeMode\|toggleTheme" src App.tsx
```

Expected: the grep prints nothing.

- [ ] **Step 4: Safe-area mock for Jest**

Append to `jest.setup.js`:

```js

// The library's own jest/mock.tsx is not transformed by the react-native preset.
jest.mock('react-native-safe-area-context', () => {
  const insets = {top: 0, right: 0, bottom: 0, left: 0};
  return {
    SafeAreaProvider: ({children}) => children,
    useSafeAreaInsets: () => insets,
  };
});
```

- [ ] **Step 5: Full checks**

Run: `npx tsc --noEmit && npx eslint src --quiet && npx jest --maxWorkers=1 2>&1 | tail -4`
Expected: no tsc / eslint output; `Test Suites: 13 passed, 13 total`, `Tests: 95 passed, 95 total` (54 before this plan plus the new radar, sheet, channel, group clip, history and memo tests; the micPolicy injection test is gone).

- [ ] **Step 6: Commit**

```bash
git add -A App.tsx src jest.setup.js
git commit -m "feat(phone): Join and Live screens replace Home and Voice; single Signal palette"
```

---

### Task 19: iOS simulator check (iPhone + Apple Watch, demo riders)

**Files:** none changed unless a check fails (then fix in the file named by the failing check and commit with a `fix(phone): …` message).

The iOS app loads a pre-bundled `main.jsbundle` (`ios/SoarXVoice/AppDelegate.swift`, `bundleURL()`), so a Debug build needs the JS bundle copied into the `.app` by hand. `.env` (with `AGORA_APP_ID`) is on the Mac, so joining a real channel works.

- [ ] **Step 1: Build the iOS app (with the watch app) for the simulator**

```bash
cd ios && export LANG=en_US.UTF-8 && bundle exec pod install >/dev/null && \
xcodebuild -workspace SoarXVoice.xcworkspace -scheme SoarXVoice -configuration Debug \
  -sdk iphonesimulator -derivedDataPath ../build-ios CODE_SIGNING_ALLOWED=NO build 2>&1 | grep -E "error:|\*\* BUILD"; cd ..
```

Expected: `** BUILD SUCCEEDED **`. Then drop the `pod install` noise, keeping the font lines of Task 9 (they are committed, so a checkout restores them):

```bash
git checkout -- ios/Podfile.lock ios/SoarXVoice.xcodeproj/project.pbxproj
git status --short ios/
```

Expected: nothing listed under `ios/`.

- [ ] **Step 2: Bundle the JS into the app, install, launch**

```bash
APP=build-ios/Build/Products/Debug-iphonesimulator/SoarXVoice.app
npx react-native bundle --platform ios --dev false --entry-file index.js \
  --bundle-output "$APP/main.jsbundle" --assets-dest "$APP"
codesign --force --sign - --timestamp=none "$APP"
xcrun simctl list pairs | grep -A2 "iPhone"     # note the iPhone (P) and watch (W) UDIDs of one pair
P=<iPhone UDID>; W=<watch UDID>
xcrun simctl boot "$P"; xcrun simctl boot "$W"; open -a Simulator
xcrun simctl privacy "$P" grant location com.xavier.comx
xcrun simctl privacy "$P" grant microphone com.xavier.comx
xcrun simctl location "$P" set 36.0143,-5.6044
xcrun simctl install "$P" "$APP"
xcrun simctl launch --terminate-running-process "$P" com.xavier.comx
sleep 6 && xcrun simctl io "$P" screenshot "$TMPDIR/join.png"
```

Expected on `join.png` (compare with the left phone of the HTML mockup):
- background `#071518`; "COMX" top left (condensed, spaced), "Settings" top right in muted teal-grey;
- three rings, the inner one teal; "CHANNEL" teal overline, "TARIFA" white and "01" teal in Barlow Condensed ExtraBold (narrow letters: if it looks like a wide system font, the fonts are not bundled, go back to Task 9 steps 2–4);
- favourite pills (if any saved) and a ghost "EDIT" pill;
- "Riding as <name>" and a 72 pt teal "JOIN" pill (dimmed at 35 % if the name is empty).

- [ ] **Step 3: Join screen interactions**

Expected, each checked on the simulator:
- tap the channel code: an inline field opens in uppercase; typing `tarifa 02` gives `TARIFA02` (spaces removed); typing `!` shows the red "Letters, digits and "-" only" line and JOIN dims;
- EDIT → sheet with "SAVE TARIFA-01", "RANDOM CHANNEL" (changes the code to `XXX-NN`), the favourites with "REMOVE", "DONE"; after SAVE the pill appears on the Join screen; kill and relaunch the app: the pill is still there (`@soarx_favorite_channels`);
- tap "Riding as …": an inline name field; the keyboard does not cover it;
- Settings opens and Back returns to Join; Settings colours are the Signal teal / dark teal.

- [ ] **Step 4: Live screen with demo riders**

Settings → Demo riders ON → back. Set the channel to `TEST-` + two digits of your choice, JOIN. Wait 10 s for GPS and the demo riders (150, 450, 900 m).

```bash
xcrun simctl io "$P" screenshot "$TMPDIR/live.png"
```

Expected on `live.png` (compare with the middle phone of the mockup):
- channel name top left (24 pt condensed), "● 4 RIDERS" in teal under it; "N ↑" red top right;
- a full-screen radar: outer ring labelled "900 M" bottom right of the ring, inner ring "200 M"; red "N" above the outer ring; a white me-arrow in the centre;
- three teal 44 pt badges "L", "T", "M" with "150"/"450"/"900" under them, Max (900 m) on the outer ring, Lea at about sqrt(150/900) = 41 % of the radius; no two badges overlap;
- the sheet (`#0F2327`, top radius 28, grabber) with three rows "LEA (DEMO) 150 M", "TOM (DEMO) 450 M", "MAX (DEMO) 900 M", teal arrows pointing to their bearings, nearest first;
- the control row: red-outlined "SOS" circle, teal "TALK / TAP TO TALK"… (the TALK pill is yellow "LIVE / TAP TO MUTE" right after joining, since the mic starts live), "MEMO" and "MSG" circles.

Then:
- wait 30 s: the badges and row arrows move as the demo riders circle; arrows turn smoothly (300 ms), never the long way round;
- tap TALK: it turns teal "TALK / TAP TO TALK" with the mute sound; tap again: yellow "LIVE"; the BLE button / HID path is unchanged (not testable on the simulator);
- drag the grabber up: the sheet grows to 90 % and the rows scroll; down: only the control row is left; tap the grabber: it cycles collapsed → medium → large; the control row never leaves the screen;
- tap "N ↑": it reads "COG ↑" (with a simulated still location the course is unknown, so the radar stays north up: correct);
- SOS from a demo rider (Settings is reached from Join only): MSG → Leave group, Settings → "Simulate an SOS from Tom", back, JOIN the same channel: Tom's badge is red and 6 pt bigger, his row is red with a light "SOS" chip and sorts first; leave, Settings → "Cancel Tom's SOS", join again: back to teal;
- hold SOS 1 s: vibration, the button fills red and reads "CANCEL"; Lea's quick reply arrives; tap CANCEL: back to the outline.

- [ ] **Step 5: Memos in demo mode**

Expected:
- tap MEMO: it turns red "SEND 30" and counts down; a red banner "Memo to the group · 29 s. Tap a rider …" appears under the title; rider rows get a teal outline;
- speak into the Mac microphone 3 s, tap "TOM (DEMO)": the memo stops, the banner goes; 2 s later the memo comes back from Tom and plays on the phone (you hear your own voice), MSG → HISTORY shows "TOM (DEMO) · HH:MM — Voice, 3 s · for you" on top (yellow dot, surfaceAlt highlight) and "TO TOM (DEMO) · HH:MM — Voice, 3 s" under it;
- tap that history row: it plays again; tap the older one: it plays too;
- tap MEMO and tap it again after 0.3 s: "Voice memo too short, not sent" in the history;
- tap MEMO and wait 30 s: it sends by itself to the group (no echo for a group memo in a real channel: correct, only memos to a virtual rider are echoed); the history shows "TO GROUP · HH:MM — Voice, 30 s";
- MSG: six quick-message pills (two columns, "I NEED HELP" amber); tapping one closes the sheet and Lea answers 3 s later (history row with a teal ring marker); "SPEAKER OFF" toggles to a teal "SPEAKER ON"; "PAUSE FOR VIDEO" toggles to "RESUME AUDIO"; "Leave group" asks "Are you sure…"; Cancel stays, Leave goes back to Join; MSG history is still there after re-joining (kept for the app's run).

- [ ] **Step 6: Decide the mic-recording approach (Decision 2)**

The replay in step 5 must contain your voice. If the memos are silent (the history shows them but nothing is heard, while quick messages and demo echoes work), switch to fallback B: in `src/contexts/AgoraContext.tsx`, replace the body of `applyLocalStreamMute` with

```ts
  const applyLocalStreamMute = useCallback((engine: IRtcEngine) => {
    engine.muteLocalAudioStream(micOverrideRef.current === 'normal' ? isMutedRef.current : false);
    // Memo: keep capturing for the file recorder, stop publishing the mic track
    engine.updateChannelMediaOptions({publishMicrophoneTrack: !memoCaptureRef.current});
  }, []);
```

rebuild the bundle (step 2) and repeat step 5; commit with `fix(agora): stop publishing the mic track while a memo records`. If it is still silent, stop and report to the owner (fallback C needs their decision). Record which approach worked in the PR description. Real-iPhone confirmation happens on the TestFlight build (Task 22).

- [ ] **Step 7: Apple Watch in demo mode (watch → phone group memo)**

Build and install the watch app on `W` as in `docs/superpowers/plans/2026-10-18-comx-step2-watch-restyle.md` ("Build and screenshot commands"). With the phone still joined to `TEST-NN` and demo on:
- the watch shows the three riders; Settings on the phone shows the Apple Watch active, so the TALK slot reads "WATCH MODE / TALK ON YOUR WATCH" in a `#12282C` pill (Settings → Watch mode "On" if auto does not trigger in the simulator);
- record a group memo on the watch (Talk page, tap, speak, tap): the phone history shows "TO GROUP · HH:MM — Voice, N s" and the memo is sent over the data stream (Metro / `appLog` line `sending N slices to the group`), not mixed into the live audio;
- record a memo to Tom on the watch: 2 s later the watch plays Tom's echo and its History shows it; the phone does not play it (watch mode, Decision 3) but lists it in its history.

---

### Task 20: Android emulator check and a real two-phone memo test

**Files:** none changed unless a check fails.

- [ ] **Step 1: Start the emulator and the app**

```bash
~/Library/Android/sdk/emulator/emulator -avd ComX_Phone34 >/dev/null 2>&1 &
adb wait-for-device && sleep 20
adb emu geo fix -5.6030 36.0150
npx react-native start     # in a second terminal tab; leave it running
npx react-native run-android --appId com.xavier.comx
```

If the launch step fails with "Activity class does not exist", start it by hand: `adb shell am start -n com.xavier.comx/com.soarxvoice.MainActivity`. In the emulator's Extended controls → Microphone, turn on "Virtual microphone uses host audio input".

Expected: the Join screen as in Task 19 step 2, in Barlow Condensed (narrow letters; if it is Roboto, `android/app/build.gradle` sourceSets from Task 9 step 5 did not apply: check `unzip -l android/app/build/outputs/apk/debug/app-debug.apk | grep fonts/` lists six `.ttf`).

- [ ] **Step 2: Same checks as iOS**

Repeat Task 19 steps 3–5 on the emulator (demo riders, radar, sheet detents, SOS, MSG, memos with echo). Expected: identical results; the arrows render as clean chevrons (no gaps on the notch); the hardware Back button closes the MSG sheet and the favourites sheet.

- [ ] **Step 3: Two real riders: iOS simulator + Android emulator in one channel**

Turn demo riders OFF on both. Join the same `TEST-NN` channel on the iPhone simulator and on the emulator, with different names (e.g. "Ios Sim", "Droid Emu"), at slightly different locations (`xcrun simctl location "$P" set 36.0143,-5.6044`, `adb emu geo fix -5.6030 36.0150`).

Expected:
- each phone shows the other as a badge and a row with a distance of about 160 m and an arrow; "● 2 RIDERS";
- speak on one side with TALK live: the other side's row turns yellow and its badge yellow with a halo while the voice is heard; both turn back to teal after;
- group memo from the emulator (MEMO, speak, MEMO): after about 0.7 s of transfer per second of voice, the iPhone plays it and lists "DROID EMU · HH:MM — Voice, N s"; the emulator lists "TO GROUP …"; while the emulator recorded, the iPhone heard nothing live from it (live stream muted during the memo) and the emulator's TALK state after sending is what it was before;
- private memo from the iPhone (MEMO, speak, tap the "DROID EMU" row): the emulator plays it, history "IOS SIM · HH:MM — Voice, N s · for you";
- SOS from one side: the other side's row turns red with "SOS" first in the list, badge red; voice announcement and vibration as before; cancel clears it;
- a quick message from MSG appears in the other phone's history with the teal ring marker and is announced as before;
- Leave on one side: the other side announces "<name> left" and the rider disappears.

- [ ] **Step 4: Older rider (optional, if a 0.1 (7) build is at hand)**

With an older ComX on one side: group memos from the new side are not received (expected, Decision 5); the older side's watch group clips are heard live on the new side.

---

### Task 21: Documentation

**Files:**
- Modify: `docs/watch-companion.md`, `CLAUDE.md`

- [ ] **Step 1: Watch → phone voice in `docs/watch-companion.md`**

Replace the numbered list under "Voice from a watch is **walkie-talkie style**, not a live call:" with:

```markdown
1. The rider presses the talk button, speaks, presses again (or releases).
2. The watch records an AAC clip (mono, 16 kHz, ≤ 30 s) and sends the file
   to the phone.
3. The phone sends it as a **voice memo** over the Agora data stream (`vc`
   messages, below) to the group or to one rider. Every receiving phone plays
   it (unless it is in watch mode), forwards it to its watch and keeps it in
   its history. Since protocol version 2 it is no longer mixed into the live
   audio.
```

and replace the sentence "In **watch mode** the phone mic is silenced (`adjustRecordingSignalVolume(0)`) because it sits in a pouch; the stream stays published so injected clips go out." with:

```markdown
In **watch mode** the phone mic is silenced (`adjustRecordingSignalVolume(0)`)
because it sits in a pouch.
```

- [ ] **Step 2: Replace the "### Targeted voice messages" section (down to the paragraph ending "crosses the data stream in a few seconds.") with**

```markdown
### Voice memos (protocol version 2)

A memo goes to the whole group or to **one rider**. It is recorded on the
watch (clip metadata `to`) or on the phone (MEMO button: tap to record, the
live microphone is muted meanwhile, tap again to send to the group, or tap a
rider row to send to that rider only; 30 s at most).

```json
{"v": 2, "kind": "clip", "durationMs": 3100, "to": 12345}
```

`to` absent, `null` or `0` = group. The phone sends the file over the Agora
data stream, sliced (`src/ride/voiceClips.ts`); `to: 0` addresses every rider
(Agora never assigns uid 0), any other value one rider. Receiving phones play
it (not in watch mode), forward it to their watch (`sendClip` with
`"private": true` for a private memo) and keep it in the MSG history (30 items,
10 memos, for the app's run). Phone memos are recorded with Agora's own file
recorder (`startAudioRecording`, `AudioFileRecordingMic`) while the live
stream is muted.

Phone ↔ phone, chunked over the data stream (each message < 1 KB):

| `type` | Fields |
| --- | --- |
| `vc` | `id` (clip id), `to` (uid, or `0` for the group), `seq` (0-based), `n` (chunk count), `d` (base64 slice, ≤ 600 chars), `ms` (duration, on chunk 0), `ext` (`m4a` / `aac`, on chunk 0) |

Slices go out every 150 ms: about 7 s for 10 s of voice at 16 kbit/s.

**Older riders** (protocol version 1) ignore `to: 0` slices, so they do not
get group memos; their own watch group clips are still mixed into the live
audio, which new phones hear. Every rider should run the same ComX.
```

In the "New bridge methods" table below it, change the `readClipBase64` purpose to "Read a clip file as base64 (to send it as a memo)" and add a line under the table: `Both exist on iOS and Android.`

Change `Version field \`v: 1\`.` near "## Phone ↔ watch" to `Version field \`v\` (currently 2; watches ignore it).`

- [ ] **Step 3: `CLAUDE.md`**

Replace `` `npx jest --maxWorkers=1` (50 tests). `` with the count printed by `npx jest --maxWorkers=1 2>&1 | grep Tests:` (95 tests when this plan was checked: `` `npx jest --maxWorkers=1` (95 tests). ``). In the "Where things are" table add the row:

```markdown
| `src/contexts/MemoContext.tsx` | Voice memos (phone MEMO button and watch clips): send, receive, play, forward, history |
```

- [ ] **Step 4: Commit**

```bash
git add docs/watch-companion.md CLAUDE.md
git commit -m "docs: group voice memos, phone memos, protocol version 2"
```

---

### Task 22: Final checks and pull request

- [ ] **Step 1: Cheap checks once more**

Run: `npx tsc --noEmit && npx eslint src --quiet && npx jest --maxWorkers=1 2>&1 | tail -4`
Expected: no tsc / eslint output; every suite passes.

- [ ] **Step 2: Nothing stray in the branch**

```bash
git status --short
git diff --stat main...HEAD
git log --format='%an %s%n%b' main..HEAD | grep -i -E "co-authored|claude|generated" || echo "no attribution"
```

Expected: a clean tree (no `ios/Pods`, `build-ios`, `Podfile.lock` changes); the stat lists only the files of the table at the top; the last command prints `no attribution`.

- [ ] **Step 3: Push and open the pull request**

```bash
git push -u origin phone-signal-radar
gh pr create -R xavierkain-apps/comx --base main --head phone-signal-radar \
  --title "Phone: Signal · Radar and voice memos" \
  --body "Step 3 of docs/superpowers/specs/2026-10-18-comx-standalone-signal-radar-design.md, plan docs/superpowers/plans/2026-10-19-comx-step3-phone.md.

- Signal palette and Barlow / Barlow Condensed (OFL) on iOS and Android.
- Join screen (radar hero, favourites, inline name) and Live screen (full-screen radar ported from the watch OverviewPage, three-detent sheet, SOS / TALK / MEMO / MSG, amber banners), MSG sheet (quick messages, history with replay, speaker, video pause, leave).
- Voice memos on the phone (group or one rider, 30 s), group memos as data-stream clips with to: 0; a watch group memo is now a real memo instead of being mixed into the live audio. Protocol version 2: riders on an older ComX do not get group memos.
- Android bridge gains readClipBase64 / writeClip.
- Unit tests: radar maths (shared cases for the Wear OS port), sheet detents, channel split, group clips, history trimming, memo helpers.
- Checked: iPhone + Apple Watch simulators in demo mode, Android emulator, and iOS simulator + Android emulator in one real channel (memos both ways, speaking, SOS).
- Phone mic recording approach used: <muted stream | publishMicrophoneTrack false> (Task 19 step 6). To confirm on a real iPhone with the TestFlight build."
```

Fill the `<…>` with the approach that worked. The description carries no AI attribution (owner's rule).

- [ ] **Step 4: Hand over**

Give the PR URL to the ComX server session; it reviews, merges, tags a TestFlight build and builds the APKs. The owner tries memos and the radar on the water before step 4 starts.

---

## Done when

- Every "Expected" list of Tasks 19 and 20 is met on the iPhone simulator, the Apple Watch simulator and the Android emulator, including the two-rider memo test.
- `npx tsc --noEmit`, `npx eslint src --quiet` and `npx jest --maxWorkers=1` are clean; CI (iOS watch build check, Android APKs) is green on the pull request.
- BLE button, HID, auto-disconnect, voice announcements, watch bridge, Garmin "talk via phone" and Settings behave as before.
- The PR is merged by the ComX session and the phone mic recording is confirmed on a real iPhone.

---

## Self-review

**Spec coverage ("Step 3: phone" and the owner's list):**

| Requirement | Task |
|---|---|
| Signal palette replaces dark mode, no light mode | 1, 18 (ThemeContext) |
| Barlow + Barlow Condensed bundled (OFL), source and method | 9 |
| No heavy dependency; arrow without SVG | Decision 1, 10 (`Arrow`) |
| Join: COMX + Settings, radar hero, code split at last "-", tap to edit with `isValidChannelName` | 4, 16 |
| Join: favourites pills from `@soarx_favorite_channels` + EDIT (manage, random, save/unsave) | 16 |
| Join: "Riding as <name>" tap to edit, 72 pt JOIN, CONNECTING…, disabled | 16 |
| Live: full-screen radar, ported maths with unit tests (sqrt, spread, niceDistance, short distance) | 2, 10 (`RadarView`), 17 |
| Live: channel + "● N RIDERS" / RECONNECTING… / CONNECTION LOST, arrow mode | 17, Decisions 7 and 9 |
| Live: bottom sheet with three detents (Animated + PanResponder) | 3, 10 (`BottomSheet`) |
| Rider rows: arrow, name, distance; yellow speaking, red SOS with "SOS", No GPS dimmed; `buildRiderViews` order | 10 (`RiderRow`), 17 (rows in `riders` order) |
| Control row: SOS 1 s long press / CANCEL, TALK = existing mute, WATCH MODE pill, MEMO, MSG | 10 (`ControlRow`), 17 |
| Banners: amber pill with STAY (inactivity, interruption, location) | 10 (`Banner`), 17 |
| MEMO: tap records (red, 30 s countdown, live mic muted), tap sends to group, rider row = that rider only | 7, 12, 14, 17 |
| Received memos play, forwarded to the watch, into history | 14 |
| Transport `to: 0` = group with tests; private unchanged | 5 |
| Watch group memo becomes a real memo (WatchContext `startAudioMixing` path removed) | 8, 13, 14 |
| Protocol version bumped; older rider behaviour | 5, 21, Decision 5 |
| Phone mic recording while in the channel without publishing, with fallback | 12, 14, 19 step 6, Decision 2 |
| MSG sheet: quick message pills, history (texts, SOS, memos with replay, newest first, 30 / 10, app run), speaker, video pause/resume, Leave group red with confirmation | 6, 15 |
| Unit tests for every pure module | 2, 3, 4, 5, 6, 7, 8 |
| iOS simulator + Android emulator checks with demo riders, pre-bundled JS on iOS | 19, 20 |
| Branch `phone-signal-radar`, PR to main, no attribution, never push to main | 1, 22 |
| Existing behaviour kept (BLE, HID, auto-disconnect, TTS, watch bridge, Garmin, Settings) | 13 (Garmin / watch code kept verbatim), 17 (`useBluetoothHID`, inactivity effect), 18 (Settings untouched), 19–20 checks |
| Android lacked `readClipBase64` / `writeClip` (found while planning) | 11 |

Not covered, on purpose: the 150 ms cross-fade of the yellow highlight (the row and badge switch colour at once; a `LayoutAnimation` can be added later), `to` from Wear OS clip metadata (the Android bridge does not forward it yet; Wear OS memos are step 4, until then a Wear OS memo goes to the group), the handoff's three-button control row (Decision 10).

**Placeholder scan:** no "TBD"/"TODO"/"similar to"; the only fill-ins are the simulator UDIDs (`P`, `W`) and the channel digits, which depend on the machine, and the PR line naming the recording approach chosen in Task 19 step 6.

**Identifier consistency:** `signal`, `condensed`, `plain`, `colors` (theme); `point`, `spread`, `niceDistance`, `shortDistance`, `ringDistance`, `initials`, `layoutRadar`, `MIN_FARTHEST_M`, `ArrowMode`, `arrowHeading`, `nextRotation` (radar); `Detents`, `HANDLE_HEIGHT`, `CONTROL_HEIGHT`, `SHEET_MEDIUM`, `sheetDetents`, `clampSheet`, `settleDetent`, `nextDetent` (sheet); `splitChannelCode`; `GROUP_UID`, `isClipForMe`, `PROTOCOL_VERSION = 2`; `addToHistory`, `HISTORY_MAX_ITEMS`, `HISTORY_MAX_CLIPS`; `MEMO_MAX_MS`, `MEMO_MIN_MS`, `memoSecondsLeft`, `memoDurationMs`, `memoRecipient`, `memoSummary`, `newClipId`, `historyTitle`; `HistoryClip`, `RideMessage.clip`, `logMessage(from, id, text, uid?, clip?)`; `setMemoCapture`, `isMemoCapture`; `voiceWatch`; `MemoProvider`, `useMemos` → `recording`, `secondsLeft`, `canRecord`, `startMemo`, `sendMemo`, `replay`; components `Arrow`, `RadarView`, `BADGE`, `RiderRow`, `Banner`, `ControlRow`, `TalkState`, `BottomSheet`, `MsgSheet`; screens `JoinScreen`, `LiveScreen`. Existing identifiers used as found in the code: `buildRiderViews`, `RiderView`, `QUICK_MESSAGES`, `formatDistance`, `isValidChannelName`, `generateChannelName`, `splitClip`, `parseVoiceChunk`, `ClipAssembler`, `CHUNK_INTERVAL_MS`, `MAX_CLIP_CHARS`, `DEMO_RIDERS`, `demoRider`, `isDemoUid`, `WatchBridge.readClipBase64/writeClip/sendClip/sendEvent/onClip/getClipDir`, `useMute`, `useBluetoothHID`, `soundFile`, `micPolicy`, `AudioFileRecordingType.AudioFileRecordingMic`, `AudioMixingStateType.AudioMixingStateStopped/Failed`.
