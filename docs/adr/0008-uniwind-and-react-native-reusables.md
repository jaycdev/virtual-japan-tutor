# Uniwind and React Native Reusables are the styling and component base

The app is styled with Uniwind (Tailwind CSS 4 for React Native) and built from React Native Reusables, a shadcn/ui-style component set whose code is copied into the repo, plus its RN Primitives. One theme in `global.css` drives Android and web, including light and dark. We chose Uniwind over NativeWind because NativeWind's stable v4 is on Tailwind 3 and its Tailwind 4 version (v5) was still a release candidate. React Native Reusables has supported Uniwind officially since December 2025.

## Consequences

- Every colour, size and font comes from `global.css` theme variables. Hardcoded hex values in components are a bug.
- Components that don't take `className` (for example `react-native-svg` paths in the pitch graph) are wrapped with `withUniwind` so they follow the theme.
- Uniwind applies light, dark or system but does not save the choice. The app saves it per device itself.
