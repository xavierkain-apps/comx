# ComX step 1: standalone repository — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ComX builds and ships (TestFlight, Android and Wear APKs, Garmin) from its own public repository `xavierkain-apps/comx`, and the `comx` branch of `soarx-voice` is frozen.

**Architecture:** Copy branch `comx` of `xavierkain-apps/soarx-voice`, history included, as branch `main` of a new public repository. Delete what only serves SoarX Voice, point every ComX workflow at `main`, set the secrets, then prove the pipeline with a CI run and a TestFlight tag. No app code changes in this step.

**Tech Stack:** GitHub (gh CLI, Actions), fastlane + match (shared certificates in `xavierkain-apps/apple-certs`), React Native 0.84, Xcode / watchOS, Gradle (phone + Wear OS), Connect IQ.

**Spec:** `docs/superpowers/specs/2026-10-18-comx-standalone-signal-radar-design.md` ("Step 1: repository and builds").

**Who does what:** the ComX server session runs Tasks 1, 3, 4, 5, 7 and 8. Xavier does Task 2 (secrets: only he has the originals) and the device check in Task 6. Never run Gradle, Xcode or monkeyc builds on the server (7 GB RAM, see CLAUDE.md): everything compiles on GitHub Actions.

---

## Files

| File | Change |
|---|---|
| `.github/workflows/ios-testflight.yml` | Delete (SoarX Voice TestFlight, tag `v*`) |
| `.github/workflows/android-release.yml` | Delete (SoarX Voice Android release, tag `v*`) |
| `.github/workflows/ci.yml` | Trigger on `main` instead of `master` |
| `.github/workflows/watch-ios-build.yml` | Trigger on `main` and pull requests |
| `.github/workflows/watch-android-build.yml` | Trigger on `main` and pull requests |
| `.github/workflows/watch-garmin-build.yml` | Trigger on `main` (paths `garmin/**`) and pull requests |
| `.github/workflows/comx-testflight.yml` | Comment: release from `main` |
| `README.md` | Rewritten for ComX |
| `CLAUDE.md` | Repository, remote and branch facts; SoarX section becomes history |
| `soarx-voice` branch `comx` (old repo) | Final commit: frozen, `comx-testflight.yml` removed |

`fastlane/Fastfile` already targets ComX only (`com.xavier.comx` and its watch and controls IDs) and needs no change. Internal names (`SoarXVoice` Xcode scheme, `SoarXVoiceWatch` target, `com.soarxvoice` Kotlin namespaces) stay: renaming them is out of scope and would touch signing.

---

### Task 1: Create the repository with the comx history

- [ ] **Step 1: Check the name is free**

Run: `gh repo view xavierkain-apps/comx`
Expected: `GraphQL: Could not resolve to a Repository with the name 'xavierkain-apps/comx'.`

- [ ] **Step 2: Create the public repository, empty**

```bash
gh repo create xavierkain-apps/comx --public \
  --description "ComX Rider: friends on a radar, voice memos and SOS, phone and watches"
```

Expected: `✓ Created repository xavierkain-apps/comx on GitHub`

- [ ] **Step 3: Push branch comx as main, with history**

From the existing checkout (remote `org` = soarx-voice on the server, `origin` on the Mac):

```bash
git fetch org comx
git push https://github.com/xavierkain-apps/comx.git refs/remotes/org/comx:refs/heads/main
gh repo edit xavierkain-apps/comx --default-branch main
```

Expected: `* [new branch] org/comx -> main`. Do not push tags: `comx-v*` tags would start TestFlight runs before the secrets exist.

- [ ] **Step 4: Verify**

Run: `gh api repos/xavierkain-apps/comx/commits/main --jq .sha`
Expected: the same SHA as `git rev-parse org/comx`.

Pushing `main` starts the workflows that already trigger on pushes (CI does not yet: it listens to `master`). Failures at this point are expected until Task 2 and Task 3 are done.

### Task 2: Secrets (Xavier)

- [ ] **Step 1: See which organisation secrets apply**

Xavier runs (his token can read them; the server session's cannot):

```bash
gh secret list --org xavierkain-apps
```

An organisation secret is available to `comx` only if its visibility includes public repositories (`all` or a selected list containing `comx`).

- [ ] **Step 2: Set every missing one in the repository, from the originals**

The values cannot be read back from `soarx-voice`. Copy each original value, then:

```bash
gh secret set ASC_KEY_ID        -R xavierkain-apps/comx --body "$(pbpaste | tr -d '[:space:]')"
gh secret set ASC_ISSUER_ID     -R xavierkain-apps/comx --body "$(pbpaste | tr -d '[:space:]')"
gh secret set ASC_KEY_P8_BASE64 -R xavierkain-apps/comx --body "$(pbpaste | tr -d '[:space:]')"
gh secret set APPLE_TEAM_ID     -R xavierkain-apps/comx --body "S96H22CQ8W"
gh secret set MATCH_PASSWORD    -R xavierkain-apps/comx --body "$(pbpaste | tr -d '[:space:]')"
gh secret set MATCH_GIT_URL     -R xavierkain-apps/comx --body "$(pbpaste | tr -d '[:space:]')"
gh secret set MATCH_GIT_TOKEN   -R xavierkain-apps/comx --body "$(pbpaste | tr -d '[:space:]')"
gh secret set AGORA_APP_ID      -R xavierkain-apps/comx --body "$(pbpaste | tr -d '[:space:]')"
```

`MATCH_PASSWORD` must be the shared passphrase of `xavierkain-apps/apple-certs`: a wrong one makes the certificate store unreadable for every app. `MATCH_GIT_TOKEN` is a PAT whose resource owner is the organisation, with write access to `apple-certs`.

- [ ] **Step 3: Verify the names**

Run: `gh secret list -R xavierkain-apps/comx`
Expected: the eight names above (or fewer, the rest coming from the organisation).

### Task 3: Remove the SoarX Voice workflows

**Files:** delete `.github/workflows/ios-testflight.yml`, `.github/workflows/android-release.yml`

- [ ] **Step 1: Clone the new repository**

```bash
git clone https://github.com/xavierkain-apps/comx.git ~/comx && cd ~/comx
```

- [ ] **Step 2: Delete**

```bash
git rm .github/workflows/ios-testflight.yml .github/workflows/android-release.yml
```

- [ ] **Step 3: Check nothing else refers to them**

Run: `grep -rn "ios-testflight\|android-release\|Android — Release\|iOS — TestFlight" --exclude-dir=node_modules . | grep -v "^./docs/superpowers"`
Expected: matches only in `CLAUDE.md` and `docs/` prose, which Task 5 rewrites. No workflow or script matches.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(comx): remove the SoarX Voice release workflows"
```

### Task 4: Point the ComX workflows at main

**Files:** `.github/workflows/ci.yml`, `watch-ios-build.yml`, `watch-android-build.yml`, `watch-garmin-build.yml`, `comx-testflight.yml`

- [ ] **Step 1: ci.yml**

Replace the `on:` block with:

```yaml
on:
  push:
    branches: [main]
  pull_request:
```

- [ ] **Step 2: watch-ios-build.yml**

Replace its `on:` block with:

```yaml
on:
  workflow_dispatch:
  push:
    branches: [main]
  pull_request:
```

- [ ] **Step 3: watch-android-build.yml**

Replace its `on:` block with (the `paths-ignore` filter is the one it has today, now on both triggers):

```yaml
on:
  workflow_dispatch:
  push:
    branches: [main]
    paths-ignore: ['garmin/**', 'docs/**', '**.md']
  pull_request:
    paths-ignore: ['garmin/**', 'docs/**', '**.md']
```

- [ ] **Step 4: watch-garmin-build.yml**

Replace its `on:` block with (same `paths` and the existing `all_devices` input):

```yaml
on:
  push:
    branches: [main]
    paths:
      - "garmin/**"
      - ".github/workflows/watch-garmin-build.yml"
  pull_request:
    paths:
      - "garmin/**"
      - ".github/workflows/watch-garmin-build.yml"
  workflow_dispatch:
    inputs:
      all_devices:
        description: "Build every device in the manifest (slow)"
        type: boolean
        default: false
```

- [ ] **Step 5: comx-testflight.yml comment**

Replace the header comment with:

```yaml
# ComX (com.xavier.comx), its Apple Watch app and the Talk control.
# Release from main with a tag: git tag comx-v0.2.0 && git push origin comx-v0.2.0
# The build number is read from TestFlight and incremented.
```

- [ ] **Step 6: Validate the YAML**

Run: `for f in .github/workflows/*.yml; do ruby -ryaml -e 'YAML.load_file(ARGV[0])' "$f" && echo "ok $f"; done`
Expected: one `ok` line per file.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows
git commit -m "ci(comx): run the ComX workflows on main and on pull requests"
```

### Task 5: README and CLAUDE.md

**Files:** `README.md`, `CLAUDE.md`

- [ ] **Step 1: README.md**

Replace the whole file with:

```markdown
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

    npm ci
    cp .env.example .env   # AGORA_APP_ID, never committed
    npx tsc --noEmit && npx eslint src --quiet && npx jest --maxWorkers=1

Without an Agora App ID the app still runs in demo mode (Settings → Demo).

## Release

    git tag comx-v0.2.0 && git push origin comx-v0.2.0   # TestFlight

Android phone and Wear APKs are built on every push to `main`
(artifacts `comx-phone`, `comx-wear`).

See `CLAUDE.md` and `docs/` for the architecture and the watch protocol.
```

- [ ] **Step 2: CLAUDE.md, repository facts**

In the section "Relationship to SoarX Voice", replace the bullet that starts with "Same GitHub repo" and the bullet that starts with "It stays in the SoarX repo" with:

```markdown
- Own repository: `xavierkain-apps/comx` (public), default branch `main`,
  remote `origin`. It started as branch `comx` of `xavierkain-apps/soarx-voice`
  (history kept); that branch is frozen and SoarX Voice is not touched from
  here.
- Secrets live in this repository or at the organisation level (public
  repositories only, on the GitHub Free plan).
```

Then replace every remaining "branch **`comx`**", "push on `comx`" and "remote name `org`" in CLAUDE.md with `main` / `origin`, and the release line with:

```markdown
- Next release: `git tag comx-v0.2.0 && git push origin comx-v0.2.0`; the build
  number is read from TestFlight and incremented.
```

- [ ] **Step 3: Check**

Run: `grep -n "branch \*\*\`comx\`\|remote name \`org\`\|push on \`comx\`\|git push org" CLAUDE.md README.md`
Expected: no output.

- [ ] **Step 4: Commit and push**

```bash
git add README.md CLAUDE.md
git commit -m "docs(comx): ComX has its own repository"
git push origin main
```

### Task 6: Prove the pipeline

- [ ] **Step 1: Pushes to main are green**

Run: `gh run list -R xavierkain-apps/comx --branch main --limit 6`
Expected: `CI`, `iOS — watch build check` and `Watch — Android build` completed with `success` on the commit of Task 5.

- [ ] **Step 2: Garmin build once**

Run: `gh workflow run watch-garmin-build.yml -R xavierkain-apps/comx --ref main`, then `gh run watch -R xavierkain-apps/comx $(gh run list -R xavierkain-apps/comx --workflow watch-garmin-build.yml --limit 1 --json databaseId --jq '.[0].databaseId')`
Expected: success, artifact `comx-garmin-prg`.

- [ ] **Step 3: First TestFlight from the new repository**

```bash
git tag comx-v0.2.0 && git push origin comx-v0.2.0
```

Then: `gh run watch -R xavierkain-apps/comx $(gh run list -R xavierkain-apps/comx --workflow comx-testflight.yml --limit 1 --json databaseId --jq '.[0].databaseId')`
Expected: success; fastlane's summary lists `upload_to_testflight`. The build number is the previous TestFlight build + 1. The tag only names the release: the version shown in TestFlight stays the project's `MARKETING_VERSION` (0.1).

If match fails with a decryption error, `MATCH_PASSWORD` is wrong: stop and ask Xavier, do not let match create new certificates.

- [ ] **Step 4: Device check (Xavier)**

Install the new build from TestFlight. Expected: ComX opens on the phone and the watch, demo mode shows the three riders, the Action button Talk control still records and sends. Android: install `comx-phone` and `comx-wear` from the run of Step 1; the phone app starts.

### Task 7: Freeze the old branch

Only after Task 6 Step 3 succeeded.

- [ ] **Step 1: Final commit on soarx-voice branch comx**

In the old checkout (`soarx-voice`, branch `comx`):

```bash
git rm .github/workflows/comx-testflight.yml
```

and put at the very top of `CLAUDE.md`:

```markdown
> **Frozen.** ComX moved to `xavierkain-apps/comx` (branch `main`) on 2026-10-18.
> Do not commit here; this branch is kept for history only.
```

```bash
git add CLAUDE.md
git commit -m "chore(comx): frozen, ComX moved to xavierkain-apps/comx"
git push org comx
```

Removing `comx-testflight.yml` stops a stray `comx-v*` tag in `soarx-voice` from building ComX twice.

- [ ] **Step 2: Verify**

Run: `git ls-remote org refs/heads/comx` then `gh api repos/xavierkain-apps/soarx-voice/contents/.github/workflows/comx-testflight.yml?ref=comx`
Expected: the new SHA, then `Not Found`.

### Task 8: Move the working copies

- [ ] **Step 1: Server checkout**

Either work from `~/comx` (Task 3) from now on, or repoint the old checkout:

```bash
git remote add comx https://github.com/xavierkain-apps/comx.git
git fetch comx && git switch -c main comx/main
```

- [ ] **Step 2: Tell the Mac session**

Send the Mac session ("Tests iOS/Android locaux") the new URL and the release tag, so it reclones `xavierkain-apps/comx` into `/Users/xavier/VSCode3/ComX` before step 2 (Apple Watch restyle) starts.

---

## Done when

- `xavierkain-apps/comx` is public, default branch `main`, with the comx history.
- Its pushes run CI, the iOS watch build check and the Android build green; Garmin builds on demand.
- A TestFlight build from tag `comx-v0.2.0` installed and opened on Xavier's phone and watch.
- `soarx-voice` branch `comx` is frozen and no longer builds ComX.
