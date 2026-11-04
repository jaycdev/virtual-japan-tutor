import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EmptyState, ErrorState, ProgressStatus, SkeletonLines } from "./states.tsx";
import { Button } from "./ui/button.tsx";

describe("ErrorState", () => {
  it("states the failure in place and offers one Retry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorState message="Cannot reach the server." onRetry={onRetry} />);

    expect(screen.getByRole("alert").textContent).toContain("Cannot reach the server.");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("has no button when there is nothing to retry", () => {
    render(<ErrorState message="Fix the highlighted field." />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("EmptyState", () => {
  it("shows one line and the one action it is given", () => {
    render(
      <EmptyState message="No Stories yet." action={<Button>Generate a Story</Button>} />,
    );
    expect(screen.getByText("No Stories yet.")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});

describe("ProgressStatus", () => {
  it("exposes the bar and its status line, clamped to 0 to 100", () => {
    const { rerender } = render(<ProgressStatus value={0.4} label="Writing your Story…" />);
    const bar = screen.getByRole("progressbar", { name: "Writing your Story…" });
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByText("Writing your Story…").getAttribute("aria-live")).toBe("polite");

    rerender(<ProgressStatus value={3} label="Done" />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  });
});

describe("SkeletonLines", () => {
  it("is hidden from assistive technology and reports busy", () => {
    const { container } = render(<SkeletonLines lines={3} />);
    expect(container.firstElementChild?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelectorAll("[data-slot='skeleton']")).toHaveLength(3);
  });
});
