# Separate web and mobile apps that share logic and design tokens

Supersedes [ADR-0007](0007-one-expo-app-for-web-and-android.md).

The web app and the Android app are two apps again, each built for its own platform: `apps/web` is a Vite + React single-page app styled with Tailwind CSS 4 and shadcn/ui, and `apps/mobile` is the Expo Router app, phone-only. They share three packages and nothing else: `@vjt/core` (screen logic as React hooks), `@vjt/api-client` (the typed API client) and `@vjt/design` (design tokens). The Go server still serves the web build from `WEB_DIR`, so self-hosting doesn't change.

We reversed ADR-0007 because building one app for both widths and both platforms made each worse. On web the reader lost `<ruby>` furigana, text selection, CSS wavy marks and real hover. Every screen carried narrow and wide layouts, sheet-or-dialog switching and react-native-web workarounds (for example the `!important` font override in `global.css`). On the phone, the app carried web code, a sidebar and two-pane layouts it never shows. The duplicate Story reader that ADR-0007 removed is cheaper to keep in sync now that its logic lives in `@vjt/core` and its look comes from shared tokens.

## Considered Options

- **Keep one Expo app and optimise it per platform with `.web.tsx` / `.native.tsx` files.** Rejected because both platforms still go through react-native-web and one router and shell, and per-platform files end up as two apps sharing a folder.
- **Share a cross-platform component package.** Rejected because sharing components is what forced the lowest-common-denominator UI. We share logic and tokens, not components.

## Consequences

- `apps/app` is renamed back to `apps/mobile`. Its web export, the Sidebar, wide layouts, dialog-on-wide overlays, two-pane Settings and web font slices are removed. Mobile keeps Uniwind and React Native Reusables (ADR-0008).
- `apps/web` is rebuilt from the redesign plan (`docs/design/ui-plan.md`) with shadcn/ui on Radix, React Router, `<ruby>` furigana and CSS marks. It is desktop-first and still usable at phone widths in a browser.
- Colours, the type scale, Story text sizes, radii and font names are defined once in `packages/design` and generated into a Tailwind CSS file for web and a Uniwind CSS file for mobile. Hex values outside `packages/design` are still a lint error in both apps.
- Logic that both apps need (fetching, mutations, derived view state) belongs in `@vjt/core`, not in either app. Screen-local UI state stays in the app.
- The Go server keeps the `index.html` fallback for deep links. The Dockerfile builds `apps/web` with `vite build` instead of `expo export -p web`.
- A screen change now lands twice, once per app. The UI plan describes each screen per platform so the two can differ on purpose rather than by drift.
