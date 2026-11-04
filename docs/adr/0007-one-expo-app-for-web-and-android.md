# One Expo app builds both the web app and the Android app

Superseded by [ADR-0010](0010-separate-web-and-mobile-apps.md): the web and mobile apps are separate again.

The web app (Vite + React) and the Android app (Expo) had grown separate UIs, including two copies of the Story reader. We are replacing both with a single Expo Router app in `apps/app` (formerly `apps/mobile`). It builds for Android and, through `expo export -p web`, produces the static web files the Go server already serves from `WEB_DIR`, so self-hosting does not change. We chose this over keeping Vite with react-native-web because the component base (React Native Reusables on Uniwind, ADR-0008) is built and tested for Expo, and because one codebase removes the duplicate reader.

## Considered Options

- **Keep Vite, add react-native-web, share a `packages/ui`.** Rejected because it keeps two app shells and routers, and Expo is the main supported path for the component base.
- **React Native Reusables on mobile and plain shadcn/ui on web.** Rejected because it means two sets of components to keep looking the same.

## Consequences

- The web screens are rewritten in React Native. `apps/web` stays as the served web app until the Expo web build matches it, and is then deleted.
- The Go server must return `index.html` for unknown paths so that reloading a deep link (e.g. `/stories/123`) works.
- Web-only browser features (`<ruby>`, CSS wavy underlines) are no longer used. The reader uses marks that work on every platform.
