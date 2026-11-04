// AI Providers (ported from apps/mobile AiProvidersSettings.test.tsx): add and
// edit providers, keys staying write-only, testing one, assigning the two AI
// tasks, and the server's 409 when a provider is still in use.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderAppAt } from "../../test/renderApp.tsx";
import { fakeSettingsApi, freshState, type FakeProvider, type FakeState } from "../../test/fakeSettingsApi.ts";

const LLAMA: FakeProvider = {
  id: "p-1",
  name: "llama3",
  baseUrl: "http://localhost:11434",
  model: "llama3",
  hasApiKey: false,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};

function renderAi(overrides: Partial<FakeState> = {}) {
  const state = freshState(overrides);
  renderAppAt("/settings/ai", { api: fakeSettingsApi(state) });
  return state;
}

async function emptyMessage() {
  return screen.findByText("No providers yet. Add an OpenAI-compatible endpoint below.");
}

describe("Settings › AI Providers", () => {
  it("adds a provider without a key, and says so in its summary", async () => {
    const state = renderAi();
    await emptyMessage();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "llama3" } });
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "http://localhost:11434" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "llama3" } });
    fireEvent.click(screen.getByRole("button", { name: "Add provider" }));

    await waitFor(() => {
      const post = state.writes.find((w) => w.method === "POST" && w.path === "/ai-providers");
      expect(post?.body).toEqual({ name: "llama3", baseUrl: "http://localhost:11434", model: "llama3" });
    });
    expect(await screen.findByText("Provider added.")).toBeTruthy();
    expect(await screen.findByText("llama3 at http://localhost:11434 · No key")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit llama3" })).toBeTruthy();
  });

  it("assigns a task, shows it in the summary, and the delete then fails with the server's reason", async () => {
    const state = renderAi({ providers: [LLAMA] });
    await screen.findByRole("button", { name: "Edit llama3" });
    expect(screen.getByText("Story generation")).toBeTruthy();
    expect(screen.getByText("Grammar content")).toBeTruthy();

    // The Story generation row's own llama3 chip: the first of the two.
    const storyChip = screen.getAllByRole("button", { name: "llama3" })[0];
    if (!storyChip) throw new Error("Expected a llama3 chip on the Story generation row.");
    fireEvent.click(storyChip);
    await waitFor(() => {
      const put = state.writes.find((w) => w.method === "PUT" && w.path === "/ai-tasks/story");
      expect(put?.body).toEqual({ providerId: "p-1" });
    });
    expect(await screen.findByText("llama3 at http://localhost:11434 · No key · used for Story generation")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete llama3" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("That provider is used for a task. Choose another provider first.");
    expect(screen.getByRole("button", { name: "Edit llama3" })).toBeTruthy();
  });

  it("deletes an unused provider after a confirmation", async () => {
    const state = renderAi({ providers: [LLAMA] });
    await screen.findByRole("button", { name: "Delete llama3" });
    fireEvent.click(screen.getByRole("button", { name: "Delete llama3" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => {
      expect(state.writes.some((w) => w.method === "DELETE" && w.path === "/ai-providers/p-1")).toBe(true);
    });
    expect(await emptyMessage()).toBeTruthy();
    expect(await screen.findByText("Provider deleted.")).toBeTruthy();
  });

  it("a saved key shows only as set; removing it sends apiKey null, never the key itself", async () => {
    const state = renderAi({ providers: [{ ...LLAMA, hasApiKey: true }] });
    await screen.findByRole("button", { name: "Edit llama3" });
    fireEvent.click(screen.getByRole("button", { name: "Edit llama3" }));

    expect(await screen.findByText("Edit llama3", { selector: "h2" })).toBeTruthy();
    expect(screen.getByText("set")).toBeTruthy();
    expect(screen.queryByLabelText("New API key")).toBeNull();

    fireEvent.click(screen.getByRole("switch", { name: "Remove the saved key" }));
    expect(await screen.findByText("The saved key will be removed when you save.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      const patch = state.writes.find((w) => w.method === "PATCH" && w.path === "/ai-providers/p-1");
      expect(patch?.body).toEqual({ name: "llama3", baseUrl: "http://localhost:11434", model: "llama3", apiKey: null });
    });
    expect(await screen.findByText("Provider saved.")).toBeTruthy();
  });

  it("tests a connection and shows the answer with its latency", async () => {
    renderAi({ providers: [LLAMA] });
    await screen.findByRole("button", { name: "Test connection to llama3" });
    fireEvent.click(screen.getByRole("button", { name: "Test connection to llama3" }));

    expect(await screen.findByText("Connected (120 ms)")).toBeTruthy();
  });

  it("None unassigns a task", async () => {
    const state = renderAi({
      providers: [LLAMA],
      tasks: [
        { task: "story", providerId: "p-1" },
        { task: "grammar_content", providerId: null },
      ],
    });
    await screen.findByRole("button", { name: "Edit llama3" });
    const label = await screen.findByText("Story generation");
    const row = label.parentElement as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "None" }));
    await waitFor(() => {
      expect(state.writes.some((w) => w.method === "DELETE" && w.path === "/ai-tasks/story")).toBe(true);
    });
    expect(await screen.findByText("llama3 at http://localhost:11434 · No key")).toBeTruthy();
  });
});
