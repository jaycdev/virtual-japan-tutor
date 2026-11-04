// Stubs matchMedia for the Settings layout (1024 px breakpoint). `wide` answers the
// min-width query true; every other query answers false, as in setup.ts.
export function stubViewport(wide: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: wide && query === "(min-width: 1024px)",
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
