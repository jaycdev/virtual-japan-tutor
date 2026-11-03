import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// The provider wires a module-scope store singleton (mirroring how the app
// treats the secure store as a process singleton), so each case resets the
// module registry and re-imports a fresh provider bound to a fresh store.
async function freshThemeModule(seed: Record<string, string> = {}) {
  vi.resetModules();
  localStorage.clear();
  for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  const stub = await import("uniwind");
  (stub as unknown as { setThemeCalls: string[] }).setThemeCalls.length = 0;
  const theme = await import("./index.tsx");
  return { theme, stub: stub as unknown as { setThemeCalls: string[] } };
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("draws nothing until the saved preference is back, then paints", async () => {
    const { theme } = await freshThemeModule({ "vjt.theme": "dark" });
    render(<theme.ThemeProvider>ready</theme.ThemeProvider>);
    // Storage read is async, so the first commit draws nothing at all...
    expect(screen.queryByText("ready")).toBeNull();
    // ...and the paint happens exactly when the theme is known.
    await waitFor(() => screen.getByText("ready"));
  });

  it("applies the saved preference to Uniwind before children show", async () => {
    const { theme, stub } = await freshThemeModule({ "vjt.theme": "dark" });
    // Each child render records how many setTheme calls had already happened
    // at that moment: a render seeing 0 means a frame was painted before the
    // theme was applied (the flash this ordering contract forbids).
    const setThemeCallsAtRender: number[] = [];
    function Child() {
      setThemeCallsAtRender.push(stub.setThemeCalls.length);
      return <span>ready</span>;
    }
    render(
      <theme.ThemeProvider>
        <Child />
      </theme.ThemeProvider>,
    );
    await waitFor(() => screen.getByText("ready"));
    expect(setThemeCallsAtRender.length).toBeGreaterThan(0);
    expect(Math.min(...setThemeCallsAtRender)).toBeGreaterThan(0);
    expect(stub.setThemeCalls).toEqual(["dark"]);
  });

  it("defaults to system when nothing is saved", async () => {
    const { theme, stub } = await freshThemeModule();
    render(<theme.ThemeProvider>ready</theme.ThemeProvider>);
    await waitFor(() => expect(stub.setThemeCalls).toEqual(["system"]));
  });

  it("re-applies when the Learner changes the preference", async () => {
    const { theme, stub } = await freshThemeModule();
    function Probe() {
      const t = theme.useTheme();
      return (
        <button type="button" onClick={() => t.setPreference("dark")}>
          {t.preference}
        </button>
      );
    }
    render(
      <theme.ThemeProvider>
        <Probe />
      </theme.ThemeProvider>,
    );
    const button = await waitFor(() => screen.getByRole("button"));
    button.click();
    await waitFor(() => expect(stub.setThemeCalls).toContain("dark"));
    expect(localStorage.getItem("vjt.theme")).toBe("dark");
  });
});
