import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog.tsx";

// The Dialog primitive the Story reader's overlays are built from (ui-plan 4.1).
// These are the behaviours the reader relies on: nothing is in the document until it
// opens, it is named by its title, and Escape, its own close button and a press on
// the backdrop each close it and put focus back where it started. The last test
// keeps the panel on the theme's tokens rather than the stock shadcn palette.

function EntryDialog({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  return (
    <Dialog onOpenChange={onOpenChange}>
      <DialogTrigger>先生</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dictionary Entry</DialogTitle>
          <DialogDescription>Senses and pitch for this word.</DialogDescription>
        </DialogHeader>
        <p>先生 (sensei) teacher</p>
        <DialogFooter>
          <DialogClose>Close entry</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const WORD = "先生";
const dialog = () => screen.queryByRole("dialog");

describe("the Dialog primitive", () => {
  it("puts nothing in the document until its trigger opens it", () => {
    render(<EntryDialog />);
    expect(dialog()).toBeNull();
  });

  it("opens as a dialog named by its title, with the stock close button", async () => {
    const user = userEvent.setup();
    render(<EntryDialog />);
    await user.click(screen.getByRole("button", { name: WORD }));

    const panel = screen.getByRole("dialog", { name: "Dictionary Entry" });
    // The stock shadcn close control: it is what makes the small icon an equivalent
    // control, so WCAG 2.5.8's minimum target size does not apply to it.
    expect(within(panel).getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<EntryDialog onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole("button", { name: WORD });
    await user.click(trigger);
    expect(dialog()).toBeTruthy();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(dialog()).toBeNull());
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("closes when its own close button is clicked", async () => {
    const user = userEvent.setup();
    render(<EntryDialog />);
    await user.click(screen.getByRole("button", { name: WORD }));
    await user.click(screen.getByRole("button", { name: "Close entry" }));
    await waitFor(() => expect(dialog()).toBeNull());
  });

  it("closes when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    render(<EntryDialog />);
    await user.click(screen.getByRole("button", { name: WORD }));
    const overlay = document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement;
    await user.click(overlay);
    await waitFor(() => expect(dialog()).toBeNull());
  });

  it("paints the backdrop and the panel with the theme's tokens", async () => {
    const user = userEvent.setup();
    render(<EntryDialog />);
    await user.click(screen.getByRole("button", { name: WORD }));
    const overlay = document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement;
    const content = document.querySelector('[data-slot="dialog-content"]') as HTMLElement;
    expect(overlay.classList.contains("bg-backdrop")).toBe(true);
    expect(content.classList.contains("bg-popover")).toBe(true);
    expect(content.classList.contains("border-border")).toBe(true);
  });
});
