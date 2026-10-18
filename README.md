# ComX Rider

Friends on a radar for kitesurfers and wingfoilers: every rider with a
distance and an arrow, voice memos, live voice between phones, quick
messages and SOS. The phone stays in a waterproof pouch; the watch works
without the touchscreen.

- **iOS + Apple Watch**: TestFlight, bundle `com.xavier.comx`
  (watch `com.xavier.comx.watchkitapp`, Talk control
  `com.xavier.comx.watchkitapp.controls`)
- **Android + Wear OS**: `com.xavier.comx`
- **Garmin**: Connect IQ app (no audio)

Built with React Native + Agora RTC (phone), SwiftUI (Apple Watch), Kotlin
(Wear OS) and Monkey C (Garmin). No server: riders share a channel code.

Started from the SoarX Voice code; SoarX Voice is a separate app and
repository (`xavierkain-apps/soarx-voice`).

## Develop

```
npm ci
cp .env.example .env   # AGORA_APP_ID, never committed
npx tsc --noEmit && npx eslint src --quiet && npx jest --maxWorkers=1
```

Without an Agora App ID the app still runs in demo mode (Settings → Demo).

## Release

```
git tag comx-v0.2.0 && git push origin comx-v0.2.0   # TestFlight
```

Android phone and Wear APKs are built on every push to `main`
(artifacts `comx-phone`, `comx-wear`).

See `CLAUDE.md` and `docs/` for the architecture and the watch protocol.
