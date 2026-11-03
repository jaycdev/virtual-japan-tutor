// #42 spike placeholder for flag-off builds. index.ts requires "@spike/trial",
// and Metro resolves every static require at build time — this stub keeps the
// trial screen, the Uniwind runtime import and the 23.5 MB of Noto JP TTFs out
// of production bundles. The branch that requires it never runs when the flag
// is off, so this component is never rendered.
export function Trial(): null {
  return null;
}
