// Expo inlines EXPO_PUBLIC_* at bundle time; declare just enough for type-checking.
declare const process: { env: { EXPO_PUBLIC_API_URL?: string } };
