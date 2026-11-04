// Flag-off stub for "@dev/showcase" (see metro.config.js). index.ts requires
// "@dev/showcase" unconditionally at build time, so without this stub Metro
// would pull the showcase, the Uniwind runtime and the Noto JP fonts into
// every production bundle. The requiring branch never runs when the flag is
// off, so this component is never rendered.
export function Showcase(): null {
  return null;
}
