# Trial results — issue #42 spike (Uniwind + React Native Reusables)

Throwaway spike on this branch (`issue/42-uniwind-rnr-trial`, based on
`origin/integration/issues-42-51` @ `4aeaaff`). Nothing here is production
code: the trial screen lives in `trial/` and is only mounted when
`EXPO_PUBLIC_TRIAL=1`; the existing screens are untouched.

Stack under test: Expo SDK **58.0.22**, React Native **0.88.1**, React **19.3.0**,
react-native-web **0.21.4**, **uniwind 1.13.1 (free)** + tailwindcss **4.3.4**,
react-native-reanimated **4.7.1**, react-native-gesture-handler **~3.3.0**,
@rn-primitives/* **^1.5.2**, lucide-react-native **1.67.0** (lockfile pulls
react-native-svg **15.16.0** via the ^15.15.3 catalog peer), vitest **5.0.5**.

## Verdict table

| # | Check | Web | Android (Expo Go on MuMu x86_64, Android 15) |
|---|-------|-----|----------------------------------------------|
| 1 | RNR overlays (Dialog, Popover, DropdownMenu) | **PASS** (web-05…07) | **PASS** (android-07 dialog, android-08 popover — renders as a bottom sheet, android-09 dropdown with JP items) |
| 2 | Noto JP fonts (sans + serif, 400 + 700) | **PASS** (web-01/02, woff2) | **PASS** (android-06/12: sans UI + bold + serif story body render natively; subset TTFs load through `expo-font` in Expo Go) |
| 3 | Theme switch + persistence | **PASS** (web-03/04: switch, localStorage, no first-paint flash) | **PASS** (android-10 light switch, android-11 light restored after force-stop via SecureStore — correct theme on first paint, no flash) |
| 4 | Themed SVG (`withUniwind` + `accent-pitch`) | **PASS** (web-08/09: `--accent-pitch` resolves on the path) | **PASS** (pixel-sampled screenshots: circle is `rgb(143,168,216)` in dark/system, `rgb(47,75,124)` in light, incl. after restart) |
| 5 | Web deep-link fallback (`/stories/123` → index.html) | **PASS** (vite preview + static-server fallback logs; **but see risk below about the Go server**) | n/a |
| 6 | vitest renders RNR components | **PASS** (mobile: 18 files / 140 tests green under vitest with stubs + Oxc plugin) | n/a |

Evidence: `%LOCALAPPDATA%\Temp\opencode\vjt-ui-redesign-notes\evidence-42\`
(web-01…web-09, android-06…12; android-01…05 are the "App entry not found"
debug sequence, see gotcha 1).

## Setup that worked (inputs for #43)

- `uniwind@^1.13.1` free tier covers everything the spike needed: `Uniwind.init()`,
  `global.css` with `@import "tailwindcss"` + `@theme` tokens + `.light`/`.dark`
  via `@custom-variant`, `className` on RN views, and **runtime** theme switching
  with `Uniwind.setTheme("light" | "dark" | "system")`. ≥1.13 matters: earlier
  versions broke Expo Go because they dropped export forwarding for RN 0.88
  (expo-font/expo-asset stopped working).
- RNR installed via its CLI (`npx @react-native-reusables/cli add text button
  dialog popover dropdown-menu`) → `components/ui/*`, `lib/utils.ts`,
  `components.json`. Its deps (reanimated, gesture-handler, screens, svg,
  `@rn-primitives/portal`) coexist with Expo Go (all are in Expo Go's native
  module set; no dev client needed).
- RNR overlays need a `<PortalHost />` mounted once (Dialog renders through it).
- Fonts: `expo-font` `useFonts` with explicit `require`s; family name = file
  basename. Android gets **subset TTFs** (~4.9–6.9 MB each; full Noto JP is ~30 MB);
  web export pulls woff2 automatically from `assets/fonts/web/`.
- SVG theming: `withUniwind(Path, { fill: { fromClassName: "fillPitch", styleProperty: "fill" } })`
  — uniwind resolves the class' tokens into **inline SVG attributes**, not CSS
  classes; `accent-*` custom utilities work but note they collide with
  Tailwind's built-in `accent-color` utility namespace (spike used `accent-pitch`
  under a custom `@theme` token, which is fine).

## Gotchas (each cost real time — carry into #43)

1. **No `await` before `registerRootComponent`.** The first Android cut loaded
   the theme from SecureStore *before* registering the root. Expo Go then
   reported **"App entry not found"** with a blank screen. Root registration
   must be synchronous at module scope; do async bootstrapping inside the
   root component (the spike's `Trial()` renders `null` until the theme is
   loaded, so there is still no unstyled flash).
2. **`CI=1` disables Metro file watching** (`expo start`). Bundles stayed stale
   across edits and the failure looked like a uniwind/bytecode problem. Don't
   set CI for iterate-in-Emu-Go loops; only the final CI export runs with it.
   (Setting `EXPO_NO_BYTECODE=1` turned out **not** to be the fix once the
   `CI=1` cause was found, though the manifest still advertises bytecode.)
3. **Expo Go launch URL**: the `https://expo.dev/launch?url=…` intent form did
   not open the project on this emulator; `adb shell am start -a
   android.intent.action.VIEW -d "exp://127.0.0.1:8081"` (after
   `adb reverse tcp:8081`) works every time.
4. **vitest + RNR**: `@rn-primitives` ships **raw JSX inside `.mjs`** files —
   out-of-the-box vite won't transform them. Fix: a small inline plugin that
   runs `transformWithOxc` on `.mjs` under `@rn-primitives`, plus
   `server.deps.inline: [/@rn-primitives\//, /lucide-react-native/]`. The
   native-only modules (react-native-svg, screens, reanimated, uniwind) are
   aliased to jsdom stubs under `test/`.
5. **uniwind-types.d.ts** (generated by `npx uniwind --generate-types`) must be
   committed or regenerated before `tsc` — theme names are typed from it.
6. **web DropdownMenu trigger** doesn't open from a synthetic `.click()`; it
   listens for pointer events (dispatch `pointerdown`/`pointerup`).

## Risks / open items for #43

- **Go server vs SPA deep links**: `apps/server/internal/webui` deliberately
  has *no* index.html fallback ("the web app has no client-side routes").
  Expo Router (or any client routing) on mobile-web would break deep links
  served by the Go binary — vite preview falls back, the Go server 404s to the
  API. #43 must decide: teach webui the fallback, or keep web at `/` only.
- **Free vs Pro uniwind**: free covered this spike; Uniwind Pro adds
  `@uniwind` CLI compile-step niceties and priority support. Re-check the
  license before betting the production theme system on it.
- **Font payload**: the four subset TTFs add ~23.5 MB to the Android assets.
  Consider shipping only the weights actually needed, or on-demand font
  loading, before making this permanent.
- **Bottom-sheet Popover on Android** is how RNR renders popovers natively
  (Modal-based) — fine functionally, but the design mock-ups in #43 should
  not assume anchored callouts on Android.
- **Transient build crash**: one `pnpm build` run crashed the mobile export
  (native access violation, exit -1073741819) under turbo parallelism; an
  immediate retry passed. Watch for OOM on CI runners that export mobile +
  web in parallel.
- **Pre-existing core test flake**: `useStoryGeneration` "survives a reload"
  deterministically failed on this machine at base `4aeaaff` (the `waitFor`
  observation window was narrower than the 20 ms poll cycle). Widened the
  running queue in `test(core): …` to make it robust; unrelated to the spike.

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
