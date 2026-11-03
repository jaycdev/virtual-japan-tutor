# Trial results - issue #42 spike (Uniwind + React Native Reusables)

> Historical record. #43 removed the trial code (`trial/`, `@spike/trial`,
> `EXPO_PUBLIC_TRIAL`) and rebuilt these findings as product foundations:
> `global.css`, `src/theme/`, `src/fonts*`, `scripts/subset-fonts.mjs` and the
> dev-only `showcase/` (flag `EXPO_PUBLIC_SHOWCASE=1`, alias `@dev/showcase`).
> The commands near the bottom still work with those names swapped.

Throwaway spike on this branch (`issue/42-uniwind-rnr-trial`, based on
`origin/integration/issues-42-51` @ `4aeaaff`). Nothing here is production
code: the trial screen lives in `trial/` and is mounted only when
`EXPO_PUBLIC_TRIAL=1`; the existing screens are untouched.

Stack under test: Expo SDK **58.0.22**, React Native **0.88.1**, React **19.3.0**,
react-native-web **0.21.4**, **uniwind 1.13.1 (free, pinned exactly)** +
tailwindcss **4.3.3 (pinned exactly, see Dependencies)**,
react-native-reanimated **4.7.1** + react-native-worklets **0.13.1 (explicit)**,
react-native-gesture-handler **~3.3.0**, @rn-primitives/* **1.5.2/1.5.3
(pinned exactly)**, lucide-react-native **~1.67.0**, vitest **5.0.5**.

## Verdict table

| # | Check | Web | Android (Expo Go on MuMu x86_64, Android 15) |
|---|-------|-----|----------------------------------------------|
| 1 | RNR overlays (Dialog, Popover, DropdownMenu) | **PASS** (web-05...07) | **PASS with deviation** (android-07 dialog, android-08 popover, android-09 dropdown): the popover renders as a bottom sheet, not anchored to its trigger - that is how RNR implements Android popovers (Modal-based). Note: Android was only exercised via Expo Go on the MuMu emulator; no dev-client or release build was produced. |
| 2 | Noto JP fonts (sans + serif, 400 + 700) | **PASS** (web-01/02, woff2) | **PASS** (android-06/12: sans UI + bold + serif story body render natively; full static TTFs load through `expo-font` in Expo Go) |
| 3 | Theme switch + persistence | **PASS** (web-03/04: switch, localStorage, no first-paint flash) | **PASS** (android-10 light switch, android-11 light restored after force-stop via SecureStore - correct theme on first paint, no flash) |
| 4 | Themed SVG (`withUniwind` + `accent-pitch`) | **PASS** (web-08/09: `--accent-pitch` resolves on the path) | **PASS** (pixel-sampled screenshots: circle is `rgb(143,168,216)` in dark/system, `rgb(47,75,124)` in light, incl. after restart) |
| 5 | Web deep-link fallback (`/stories/123` -> index.html) | **FAIL against the Go server today** - see below. Works with any static fallback server (vite preview, the scratch node server). | n/a |
| 6 | vitest renders RNR components | **PASS** (mobile: 18 files / 140 tests green under vitest with stubs + Oxc plugin) | n/a |

Evidence: `%LOCALAPPDATA%\Temp\opencode\vjt-ui-redesign-notes\evidence-42\`
(web-01...web-09, android-06...12; android-01...05 are the "App entry not found"
debug sequence, see gotcha 1).

## Check 5 in detail: the Go server has no SPA fallback

`apps/server/internal/webui` deliberately routes every GET that misses a file
to the API (package doc: "The web app has no client-side routes, so there is
no index.html fallback"). The scratch test
`apps/server/internal/webui/webui_scratch_test.go` (TestDeepLinkFallbackScratch)
hits `GET /stories/123` through the real handler and asserts it today falls
through to the API - i.e. a deployed container serves the API's 404, not the
app, for any deep link. That is fine for today's web app (single page, no
client routes) but **FAIL** for any Expo Router / client-routed web build.

What #51 needs to decide (and implement if yes): a fallback that serves
`index.html` for GET/HEAD requests that (a) miss the file, (b) are not API
routes, and (c) accept `text/html` - while keeping hashed-asset misses at 404
and every non-GET method at the API. The scratch test is written to fail when
the fallback lands, so the expectation gets updated deliberately.

## Spike wiring inside the real app config (intentional)

The spike deliberately wired Uniwind into the shipped app config -
`metro.config.js` uses `withUniwindConfig`, `app.json` gained the `web`
platform and the `expo-font` plugin, and `index.ts` carries the trial gate.
Ticket #43 owns formalizing or removing that wiring; until then the real app
builds through the spike's Metro config.

To keep that from shipping spike payload, the trial entry is gated twice:
`index.ts` requires `"@spike/trial"` only inside the `EXPO_PUBLIC_TRIAL=1`
branch, and because Metro resolves every static require at build time,
`metro.config.js` additionally aliases `@spike/trial` to a null stub
(`trial-off/index.ts`) unless the flag is set. Verified with
`pnpm --filter @vjt/mobile build`: flag off -> 2.2 MB bundle, no
`dist/assets/`, no `NotoSans` strings in the bundle; flag on -> 5.9 MB bundle
plus 23.4 MB of TTF assets. The flag must be set for `expo start`/`expo export`
as well as at runtime, since the alias resolves at build time.

## Dependencies and lockfile

- `uniwind`, all `@rn-primitives/*` and `tailwindcss` are pinned **exactly**;
  `lucide-react-native` and `react-native-worklets` use `~`. This is a spike:
  reproducibility beats range flexibility.
- `tailwindcss` is pinned to **4.3.3** (not 4.3.4) to dedupe: uniwind 1.13.1
  pins `@tailwindcss/node`/`oxide` at exactly 4.3.3, which pulled a second
  tailwindcss into the lockfile. 4.3.3 is the only consumer of the duplicate
  (mobile has the only tailwindcss dependency in the repo), so matching it
  collapses the tree to one version - confirmed after `pnpm install`:
  `pnpm-lock.yaml` now lists a single `tailwindcss@4.3.3`.
- `react-native-worklets@~0.13.1` is now an explicit dependency next to
  reanimated (reanimated 4 requires it at runtime; it was only implicit
  through expo/reanimated peers before).

## Fonts: payload and licence

The four Android TTFs in `assets/fonts/` are the **full static Noto JP family
files** (~14,500 glyphs, ~4.9 MB sans / ~6.9 MB serif each, 23.4 MB total) -
the spike kept full files to measure worst-case payload. `web/*.woff2` are the
full woff2 builds (~2.0-2.7 MB each). Both families are under SIL OFL 1.1;
`OFL-notosansjp.txt`, `OFL-notoserifjp.txt` and `README.md` travel with them
(OFL requires the licence to accompany redistribution). #43 should subset
(`pyftsubset`: kana + punctuation + JLPT-range kanji) or load fonts on demand
before any of this ships.

## Setup that worked (inputs for #43)

- `uniwind@1.13.1` free tier covered everything the spike needed: `Uniwind.init()`,
  `global.css` with `@import "tailwindcss"` + `@theme` tokens + `.light`/`.dark`
  variants, `className` on RN views, and **runtime** theme switching with
  `Uniwind.setTheme("light" | "dark" | "system")`. >=1.13 matters: earlier
  versions broke Expo Go because they dropped export forwarding for RN 0.88
  (expo-font/expo-asset stopped working).
- RNR installed via its CLI (`npx @react-native-reusables/cli add text button
  dialog popover dropdown-menu`) -> `components/ui/*`, `lib/utils.ts`,
  `components.json`. Its deps (reanimated, gesture-handler, screens, svg,
  `@rn-primitives/portal`) coexist with Expo Go (all in Expo Go's native module
  set; no dev client needed).
- RNR overlays need a `<PortalHost />` mounted once (Dialog renders through it).
- Fonts: `expo-font` `useFonts` with explicit `require`s; family name = file
  basename.
- SVG theming: `withUniwind(Path, { fill: { fromClassName: "fillClassName", styleProperty: "accentColor" } })`
  - uniwind resolves the class' tokens into **inline SVG attributes**, not CSS
  classes; `accent-*` custom utilities work but collide with Tailwind's
  built-in `accent-color` utility namespace (the spike defines `accent-pitch`
  as a custom `@theme` token, which is fine).

## Gotchas (each cost real time - carry into #43)

1. **No `await` before `registerRootComponent`.** The first Android cut loaded
   the theme from SecureStore *before* registering the root. Expo Go then
   reported **"App entry not found"** with a blank screen. Root registration
   must be synchronous at module scope; do async bootstrapping inside the
   root component (the spike's `Trial()` renders `null` until the theme is
   loaded, so there is still no unstyled flash).
2. **`CI=1` disables Metro file watching** (`expo start`). Bundles stayed stale
   across edits and the failure looked like a uniwind/bytecode problem. Do not
   set CI for iterate-in-Expo-Go loops; only the final CI export runs with it.
   (Setting `EXPO_NO_BYTECODE=1` turned out **not** to be the fix once the
   `CI=1` cause was found, though the manifest still advertises bytecode.)
3. **Expo Go launch URL**: the `https://expo.dev/launch?url=...` intent form did
   not open the project on this emulator; `adb shell am start -a
   android.intent.action.VIEW -d "exp://127.0.0.1:8081"` (after
   `adb reverse tcp:8081`) works every time.
4. **vitest + RNR**: `@rn-primitives` ships **raw JSX inside `.mjs`** files -
   out-of-the-box vite will not transform them. Fix: a small inline plugin that
   runs `transformWithOxc` on `.mjs` under `@rn-primitives`, plus
   `server.deps.inline: [/@rn-primitives\//, /lucide-react-native/]`. The
   native-only modules (react-native-svg, screens, reanimated, uniwind) are
   aliased to jsdom stubs under `test/`.
5. **uniwind-types.d.ts** (generated by `npx uniwind --generate-types`) must be
   committed or regenerated before `tsc` - theme names are typed from it.
6. **web DropdownMenu trigger** does not open from a synthetic `.click()`; it
   listens for pointer events (dispatch `pointerdown`/`pointerup`).
7. **Metro bundles what it can resolve, not what runs**: an `if (flag)` around
   `require()` still puts the module (and its assets) in the bundle, because
   Metro's dependency resolution is static. Gate at the resolver (see the
   `@spike/trial` alias above) or at the entry file.

## Risks / open items for #43

- **Go server deep links** (see check 5): decide the fallback policy in #51.
- **Free vs Pro uniwind**: free covered this spike; re-check the license before
  betting the production theme system on it.
- **Font payload**: 23.4 MB of full static TTFs; subset or load on demand.
- **Bottom-sheet Popover on Android** is how RNR renders popovers natively -
  fine functionally, but #43 mock-ups should not assume anchored callouts there.
- **Expo Go is not a release build**: every Android result here comes from
  Expo Go on a MuMu x86_64 emulator. Reanimated/gesture-handler work there,
  but a dev-client (or at least an `expo run:android` build) is still needed
  to claim release-grade compatibility.
- **Transient build crash**: one `pnpm build` run crashed the mobile export
  (native access violation, exit -1073741819) under turbo parallelism; an
  immediate retry passed. Watch for OOM on CI runners that export mobile +
  web in parallel.
- **Timing-sensitive core test**: `useStoryGeneration` "finds a run that
  survives a reload" failed on this machine at base `4aeaaff` because the
  test polls at 20 ms while `waitFor` samples every ~50 ms - with only two
  `running` answers queued, the hook could reach `ready` before the first
  sample after mount, and the "running" assertion lost the race (faster host
  / warm cache made it pass earlier in the session, hence the misleading first
  impression). `test(core): widen the running window...` queues four
  `running` answers so a sample lands mid-run; it is a hardening of a flaky
  test, not a product fix.

## How to reproduce

```bash
# web trial
EXPO_PUBLIC_TRIAL=1 pnpm --filter @vjt/mobile exec expo export --platform web --output-dir dist-web-trial
# then serve dist-web-trial with any SPA-fallback static server

# Android (Expo Go 58.0.5 on MuMu: adb -s 127.0.0.1:16416)
adb -s 127.0.0.1:16416 reverse tcp:8081 tcp:8081
EXPO_PUBLIC_TRIAL=1 pnpm --filter @vjt/mobile exec expo start --offline
adb -s 127.0.0.1:16416 shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081"
```
