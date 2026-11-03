// Uniwind's runtime lives in the Metro bundler (it compiles className to
// styles); under vitest the className props on react-native-web components
// are simply ignored, and the theme API becomes a fixed light theme.
export function withUniwind<T>(component: T, mappings?: unknown): T {
  void mappings;
  return component;
}

export const Uniwind = {
  setTheme: (theme: string): void => {
    void theme;
  },
  currentTheme: "light" as string,
  hasAdaptiveThemes: true,
};

export function useUniwind() {
  return { theme: "light", hasAdaptiveThemes: true };
}
