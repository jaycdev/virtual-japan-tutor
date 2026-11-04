import { PortalHost } from "@rn-primitives/portal";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TokenMenu } from "./TokenMenu.tsx";
import type { MenuOption } from "./holdMenu.ts";

// A phone with a 34 dp gesture bar under the sheet.
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 0, right: 0 }),
}));

const OPTIONS: MenuOption[] = [
  { id: "dictionary", label: "Dictionary", enabled: true },
  { id: "save", label: "Save", enabled: true },
];

describe("TokenMenu sheet", () => {
  it("clears the bottom safe-area inset and spans the full width", () => {
    render(
      <>
        <PortalHost />
        <TokenMenu
          options={OPTIONS}
          measure={() => null}
          onRects={() => {}}
          onSelect={() => {}}
          onDismiss={() => {}}
        />
      </>,
    );
    const sheet = screen.getByTestId("token-menu");
    // 8 dp of the sheet's own padding plus the 34 dp inset below it.
    expect(sheet.getAttribute("style")).toContain("padding-bottom: 42px");
    // No width cap: the sheet used to stop 24 dp short of the right edge.
    expect(sheet.getAttribute("style")).not.toContain("max-width");
  });
});
