// Item Lists (ported from apps/mobile ItemListsSettings.test.tsx): the master
// list with its hints, adding a list, and one list's detail — Boosting, default,
// delete, and membership. The mobile "Close Item Lists" and back-button checks do
// not exist on the web, where "Back to all lists" plays that part.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderAppAt } from "../../test/renderApp.tsx";
import { fakeSettingsApi, freshState, type FakeState } from "../../test/fakeSettingsApi.ts";

function renderLists(overrides: Partial<FakeState> = {}) {
  const state = freshState(overrides);
  renderAppAt("/settings/lists", { api: fakeSettingsApi(state) });
  return state;
}

async function master() {
  const rows = await screen.findAllByRole("button", { name: /Manage/ });
  return rows[0];
}

describe("Settings › Item Lists", () => {
  it("lists every list with its hint, the default and the Boosting mark showing", async () => {
    renderLists();
    await master();
    const saved = screen.getByRole("button", { name: /Saved/ });
    expect(saved.textContent).toContain("default · 1 item");
    const food = screen.getByRole("button", { name: /Food/ });
    expect(food.textContent).toContain("0 items · boosting");
  });

  it("adds a list and shows it in the master", async () => {
    const state = renderLists();
    await master();
    fireEvent.change(screen.getByLabelText("List name"), { target: { value: "Travel" } });
    fireEvent.click(screen.getByRole("button", { name: "Add list" }));

    await waitFor(() => {
      const post = state.writes.find((w) => w.method === "POST" && w.path === "/item-lists");
      expect(post?.body).toEqual({ name: "Travel", boosting: false });
    });
    const travel = await screen.findByRole("button", { name: /Travel.*Manage/ });
    expect(travel.textContent).toContain("Travel0 items");
  });

  it("Saved is built in: no Rename, no Delete, and the Default note", async () => {
    renderLists();
    await master();
    fireEvent.click(screen.getByRole("button", { name: /Saved.*Manage/ }));
    expect(await screen.findByText("Saved is built in: it can be configured, not renamed or deleted.")).toBeTruthy();
    expect(screen.getByText("This is the Default List: a Save from a story goes here.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete list" })).toBeNull();
  });

  it("makes another list the default, and switching Boosting saves on the spot", async () => {
    const state = renderLists();
    await master();
    fireEvent.click(screen.getByRole("button", { name: /Food.*Manage/ }));

    fireEvent.click(await screen.findByRole("button", { name: "Make default" }));
    await waitFor(() => {
      const put = state.writes.find((w) => w.method === "PUT" && w.path === "/item-lists/default");
      expect(put?.body).toEqual({ listId: "food" });
    });

    const boosting = screen.getByRole("switch", { name: "Boosting" });
    expect((boosting as HTMLInputElement).checked).toBe(true);
    fireEvent.click(boosting);
    await waitFor(() => {
      const put = state.writes.find((w) => w.method === "PUT" && w.path === "/item-lists/food");
      expect(put?.body).toEqual({ boosting: false });
    });
  });

  it("deletes a list after a confirmation and lands back on the master", async () => {
    const state = renderLists();
    await master();
    fireEvent.click(screen.getByRole("button", { name: /Food.*Manage/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete list" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => {
      expect(state.writes.some((w) => w.method === "DELETE" && w.path === "/item-lists/food")).toBe(true);
    });
    expect(await screen.findByRole("button", { name: /Saved.*Manage/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Food/ })).toBeNull();
  });

  it("shows a list's members with their glosses and removes one", async () => {
    const state = renderLists();
    await master();
    fireEvent.click(screen.getByRole("button", { name: /Saved.*Manage/ }));

    expect(await screen.findByText("食べる")).toBeTruthy();
    expect(screen.getByText("to eat")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove 食べる" }));

    await waitFor(() => {
      const del = state.writes.find((w) => w.method === "DELETE" && w.path.startsWith("/item-lists/saved/items"));
      expect(del).toBeTruthy();
    });
    await waitFor(() => expect(screen.queryByText("食べる")).toBeNull());
  });

  it("adds an item by reference, announcing the add", async () => {
    const state = renderLists();
    await master();
    fireEvent.click(screen.getByRole("button", { name: /Food.*Manage/ }));
    expect(await screen.findByText("No items yet.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Reference (dictionary entry sequence or grammar point id)"), {
      target: { value: "1358280" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to list" }));

    await waitFor(() => {
      const post = state.writes.find((w) => w.method === "POST" && w.path === "/item-lists/food/items");
      expect(post?.body).toEqual({ itemKind: "vocabulary", itemRef: "1358280" });
    });
    expect(await screen.findByText("Added.")).toBeTruthy();
    const kind = await screen.findByRole("group", { name: "Kind" });
    expect(within(kind).getByRole("button", { name: "Word" }).getAttribute("aria-pressed")).toBe("true");
  });
});
