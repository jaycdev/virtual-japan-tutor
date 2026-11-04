import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { TabBar } from "./TabBar.tsx";
import { DESTINATIONS } from "./destinations.ts";

describe("TabBar", () => {
  test("renders the five destinations as tabs, marking the active one", () => {
    render(<TabBar active="/stories" onSelect={vi.fn()} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(5);
    expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual(DESTINATIONS.map((d) => d.label));
    expect(screen.getByRole("tab", { selected: true }).getAttribute("aria-label")).toBe("Stories");
  });

  test("tapping a destination reports it", () => {
    const onSelect = vi.fn();
    render(<TabBar active="/" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ path: "/settings", label: "Settings" }));
  });
});
