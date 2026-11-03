// #42 spike: throwaway spike screen (issue #42). This folder is only in the
// Metro graph when EXPO_PUBLIC_TRIAL=1 (see metro.config.js alias); flag-off
// builds resolve "@spike/trial" to ../trial-off/index.ts instead.
export { Trial } from "./Trial.tsx";
