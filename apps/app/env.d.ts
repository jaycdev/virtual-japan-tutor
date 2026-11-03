// Expo inlines EXPO_PUBLIC_* at bundle time; declare just enough for type-checking.
declare const process: { env: { EXPO_PUBLIC_API_URL?: string; EXPO_PUBLIC_TRIAL?: string } };

// The spike imports global.css for Uniwind (trial/Trial.tsx).
declare module "*.css";
