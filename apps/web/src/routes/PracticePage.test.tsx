import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderAppAt } from "../test/renderApp.tsx";

describe("/practice route", () => {
  it("renders the Practice screen in place of the placeholder", async () => {
    renderAppAt("/practice");

    expect(await screen.findByRole("heading", { name: "Practice" })).toBeTruthy();
    expect(screen.queryByText("Coming soon in #78.")).toBeNull();
    expect(screen.getByRole("button", { name: "Start a practice session" })).toBeTruthy();
  });

  it("a Story deep link starts the session on arrival, without a Start tap", async () => {
    renderAppAt("/practice?storyId=st-1");

    // The harness API answers the session start with 404, so the screen
    // shows that failure in place, proving the session was requested.
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("not found");
    });
    expect(screen.getByRole("heading", { name: "Practice" })).toBeTruthy();
  });
});
