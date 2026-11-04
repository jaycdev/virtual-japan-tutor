// Stories (ported from apps/mobile StorySettingsSection.test.tsx): the Furigana
// Threshold chips, the genre/theme suggestions, and the Timezone with its device
// shortcut. Mounted through the real route, as the Learner reaches it.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderAppAt } from "../../test/renderApp.tsx";
import { fakeSettingsApi, freshState, type FakeState } from "../../test/fakeSettingsApi.ts";

function renderStories(overrides: Partial<FakeState> = {}) {
  const state = freshState(overrides);
  renderAppAt("/settings/stories", { api: fakeSettingsApi(state) });
  return state;
}

describe("Settings › Stories", () => {
  it("prefills the stored settings, with thresholds 1–9 and no 0", async () => {
    renderStories({
      story: { furiganaThresholdSrsLevel: 6, preferredGenre: "travel", preferredTheme: "", timezone: "Asia/Tokyo" },
    });
    const group = await screen.findByRole("group", { name: "Furigana Threshold" });
    expect(within(group).getByRole("button", { name: "6" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(group).queryByRole("button", { name: "0" })).toBeNull();
    expect(within(group).getByRole("button", { name: "9" })).toBeTruthy();
    expect((screen.getByLabelText("Preferred genre") as HTMLInputElement).value).toBe("travel");
    expect((screen.getByLabelText("Your timezone") as HTMLInputElement).value).toBe("Asia/Tokyo");
  });

  it("saves a new threshold, genre and theme together", async () => {
    const state = renderStories({ story: { furiganaThresholdSrsLevel: 3, preferredGenre: "", preferredTheme: "", timezone: "" } });
    const group = await screen.findByRole("group", { name: "Furigana Threshold" });
    fireEvent.click(within(group).getByRole("button", { name: "5" }));
    fireEvent.change(screen.getByLabelText("Preferred genre"), { target: { value: "mystery" } });
    fireEvent.change(screen.getByLabelText("Preferred theme"), { target: { value: "robots" } });
    fireEvent.click(screen.getByRole("button", { name: "Save story settings" }));

    await waitFor(() => {
      const put = state.writes.find((w) => w.path === "/story-settings");
      expect(put?.method).toBe("PUT");
      expect(put?.body).toEqual({
        furiganaThresholdSrsLevel: 5,
        preferredGenre: "mystery",
        preferredTheme: "robots",
        timezone: "",
      });
    });
    expect(await screen.findByText("Saved. The next Story written for you uses this.")).toBeTruthy();
  });

  it("fills the field from a suggestion chip once the field is focused", async () => {
    renderStories({ storySuggestions: { genres: ["mystery", "travel"], themes: [] } });
    const input = (await screen.findByLabelText("Preferred genre")) as HTMLInputElement;
    await userEvent.click(input);

    const chips = await screen.findByRole("list", { name: "Preferred genre suggestions" });
    fireEvent.click(within(chips).getByRole("button", { name: "travel" }));
    await waitFor(() => expect(input.value).toBe("travel"));
  });

  it("the device button fills the timezone, and saving keeps it", async () => {
    const state = renderStories();
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timezone = (await screen.findByLabelText("Your timezone")) as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: /Use my device/ }));
    await waitFor(() => expect(timezone.value).toBe(device));

    fireEvent.click(screen.getByRole("button", { name: "Save story settings" }));
    await waitFor(() => {
      const put = state.writes.find((w) => w.path === "/story-settings");
      expect((put?.body as { timezone?: string })?.timezone).toBe(device);
    });
  });

  it("shows the server's message when the save fails", async () => {
    const state = renderStories();
    state.failNext["PUT /story-settings"] = "Timezone is unknown.";
    await screen.findByRole("group", { name: "Furigana Threshold" });
    fireEvent.click(screen.getByRole("button", { name: "Save story settings" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Timezone is unknown.");
  });
});
