import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Popover, PopoverAnchor, PopoverContent } from "./popover.tsx";

// The Popover primitive the Lookup Menu is built from (ui-plan 4.1). The reader
// anchors it to a word and opens it itself, so these tests drive it the same way:
// the card is only in the document while it is open, it is in a portal rather than
// inside the anchored word, and a press outside or Escape asks the reader to close
// it. The reader overrides that last behaviour for its own press rules, and the
// override is tested in ../reader/StoryReader.test.tsx.

function WordMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <button type="button">先生</button>
      </PopoverAnchor>
      <PopoverContent>
        <button type="button">Dictionary Entry</button>
        <button type="button">Save to Item List</button>
      </PopoverContent>
    </Popover>
  );
}

const card = () => document.querySelector('[data-slot="popover-content"]');

describe("the Popover primitive", () => {
  it("shows the card only while it is open, and in a portal", async () => {
    const onOpenChange = vi.fn();
    const { container, rerender } = render(<WordMenu open={false} onOpenChange={onOpenChange} />);
    expect(card()).toBeNull();

    rerender(<WordMenu open onOpenChange={onOpenChange} />);
    const content = card() as HTMLElement;
    const word = screen.getByRole("button", { name: "先生" });
    expect(content).toBeTruthy();
    // Anchored to the word but not inside it: the card must not be dragged into the
    // Story text's selection or copy.
    expect(content.parentElement).not.toBe(word.parentElement);
    expect(container.contains(content)).toBe(false);
    expect(content.textContent).toContain("Dictionary Entry");
  });

  it("asks to close on Escape", async () => {
    const onOpenChange = vi.fn();
    render(<WordMenu open onOpenChange={onOpenChange} />);
    (card() as HTMLElement).focus();
    const user = userEvent.setup();
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("asks to close on a press outside the card", async () => {
    const onOpenChange = vi.fn();
    render(<WordMenu open onOpenChange={onOpenChange} />);
    // Radix only starts watching the document one task after the card opens, and a
    // left press outside is only dismissed on the click that follows it.
    await screen.findByText("Dictionary Entry");
    fireEvent.pointerDown(document.body, { button: 0 });
    fireEvent.click(document.body);
    await waitFor(() => expect(onOpenChange).toHaveBeenLastCalledWith(false));
  });

  it("paints the card with the theme's popover surface", () => {
    const onOpenChange = vi.fn();
    render(<WordMenu open onOpenChange={onOpenChange} />);
    const content = card() as HTMLElement;
    expect(content.classList.contains("bg-popover")).toBe(true);
    expect(content.classList.contains("border-border")).toBe(true);
    expect(content.classList.contains("shadow-md")).toBe(true);
  });
});
