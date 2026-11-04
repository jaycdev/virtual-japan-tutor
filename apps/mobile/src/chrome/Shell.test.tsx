import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Text } from "react-native";

// The route the Shell sees is driven per test; the safe-area insets are a
// phone with a 24 dp status bar and a 34 dp gesture bar.
let pathname = "/";
vi.mock("expo-router", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 0, right: 0 }),
}));

import { Shell } from "./Shell.tsx";

afterEach(() => {
  pathname = "/";
});

describe("Shell safe-area insets", () => {
  it("pads the bottom on a reader route, where the tab bar (its usual inset owner) is hidden", () => {
    pathname = "/stories/st-1";
    render(
      <Shell>
        <Text>reader</Text>
      </Shell>,
    );
    expect(screen.getByTestId("shell").getAttribute("style")).toContain("padding-bottom: 34px");
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("leaves the bottom to the tab bar on a tab route", () => {
    pathname = "/stories";
    render(
      <Shell>
        <Text>stories</Text>
      </Shell>,
    );
    expect(screen.getByTestId("shell").getAttribute("style")).toContain("padding-bottom: 0px");
    expect(screen.getAllByRole("tab")).toHaveLength(5);
  });
});
