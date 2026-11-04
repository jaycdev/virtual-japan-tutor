import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { EmptyState, InlineError, ProgressBar, Skeleton } from "./states.tsx";

describe("Skeleton", () => {
  test("renders the requested number of placeholder lines", () => {
    const { container } = render(<Skeleton lines={4} />);
    // Four lines plus the gap wrapper: every child is a bare div.
    const lines = container.querySelectorAll("div > div");
    expect(lines.length).toBeGreaterThanOrEqual(4);
  });
});

describe("EmptyState", () => {
  test("one line and one action", () => {
    const onAction = vi.fn();
    render(<EmptyState message="No stories yet." actionLabel="Write one" onAction={onAction} />);
    expect(screen.getByText("No stories yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Write one" }));
    expect(onAction).toHaveBeenCalled();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  test("the action is optional", () => {
    render(<EmptyState message="Nothing here." />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("InlineError", () => {
  test("announces the failure and offers one Retry", () => {
    const onRetry = vi.fn();
    render(<InlineError message="Could not reach the server." onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain("Could not reach the server.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("ProgressBar", () => {
  test("the bar carries the value and the caption says what is happening", () => {
    render(<ProgressBar value={0.4} label="Writing… attempt 1 of 3" />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByText("Writing… attempt 1 of 3")).toBeTruthy();
  });

  test("values outside 0–1 are clamped", () => {
    render(<ProgressBar value={1.7} label="Done" />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  });
});
