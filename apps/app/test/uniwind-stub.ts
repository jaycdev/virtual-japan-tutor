// Uniwind's runtime lives in the Metro bundler (it compiles className to
// styles); under vitest the className props on react-native-web components
// are simply ignored, and the theme API becomes a fixed light theme.
export function withUniwind<T>(component: T, mappings?: unknown): T {
  void mappings;
  return component;
}

/** Tracks every `setTheme` call so tests can assert when the theme is applied. */
export const setThemeCalls: string[] = [];

export const Uniwind = {
  setTheme: (theme: string): void => {
    setThemeCalls.push(theme);
  },
  currentTheme: "light" as string,
  hasAdaptiveThemes: true,
};

export function useUniwind() {
  return { theme: "light", hasAdaptiveThemes: true };
}

/**
 * The real hook returns the token's resolved value; under vitest there is no
 * CSS engine, so it hands back the var() reference — enough for components to
 * pass *a* colour through and for tests to assert the token was consulted.
 */
export function useCSSVariable(name: string | string[]): string | string[] {
  return Array.isArray(name) ? name.map((n) => `var(${n})`) : `var(${name})`;
}
