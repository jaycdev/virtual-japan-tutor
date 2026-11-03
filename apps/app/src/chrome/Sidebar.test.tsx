import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { Sidebar } from "./Sidebar.tsx";

function renderSidebar(onSelect = vi.fn(), onLogout = vi.fn()) {
  render(<Sidebar active="/settings" username="learner" onSelect={onSelect} onLogout={onLogout} />);
  return { onSelect, onLogout };
}

describe("Sidebar", () => {
  test("shows the wordmark, the destinations, and the signed-in Learner", () => {
    renderSidebar();
    expect(screen.getByText("読")).toBeTruthy();
    expect(screen.getByText("learner")).toBeTruthy();
    // The a11y label names who the session belongs to, not just "Signed in as".
    expect(screen.getByLabelText("Signed in as learner")).toBeTruthy();
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("aria-label"))).toEqual([
      "Today",
      "Stories",
      "Practice",
      "Grammar",
      "Settings",
    ]);
    expect(screen.getByRole("link", { current: "page" }).getAttribute("aria-label")).toBe("Settings");
  });

  test("tapping a destination reports it", () => {
    const { onSelect } = renderSidebar();
    fireEvent.click(screen.getByRole("link", { name: "Stories" }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ path: "/stories", label: "Stories" }));
  });

  test("the foot logs out", () => {
    const { onLogout } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalled();
  });
});
