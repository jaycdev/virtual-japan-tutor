import { createApiClient } from "@vjt/api-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useItemLists } from "./useItemLists.ts";

function fakeClient() {
  const fetchImpl = vi.fn();
  const client = createApiClient({ baseUrl: "http://127.0.0.1:8787", fetch: fetchImpl });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": status === 204 ? "" : "application/json" },
    });
  return { client, fetchImpl, json };
}

const SAVED = { id: "l1", name: "Saved", boosting: true, isDefault: true, itemCount: 3 };
const TRAVEL = { id: "l2", name: "travel", boosting: false, isDefault: false, itemCount: 7 };
const listsBody = { items: [SAVED, TRAVEL], defaultListId: "l1" };

describe("useItemLists", () => {
  it("loads the lists and the effective default", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl.mockImplementation(async () => json(200, listsBody));
    const { result } = renderHook(() => useItemLists(client));

    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    const st = result.current.state;
    expect(st.status === "ready" && st.lists.map((l) => l.name)).toEqual(["Saved", "travel"]);
    expect(result.current.defaultListId).toBe("l1");
    const call = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(call.url).toContain("/item-lists");
  });

  it("creates a list and re-reads so counts and the default marker stay honest", async () => {
    const { client, fetchImpl, json } = fakeClient();
    let lists = listsBody;
    fetchImpl.mockImplementation(async (req: Request) => {
      if (req.method === "POST") {
        const body = await req.json();
        lists = {
          ...lists,
          items: [...lists.items, { id: "l3", ...body, isDefault: false, itemCount: 0 }],
        };
        return json(201, { id: "l3", ...body, isDefault: false, itemCount: 0 });
      }
      return json(200, lists);
    });
    const { result } = renderHook(() => useItemLists(client));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    const res = await act(async () => result.current.createList({ name: "food", boosting: true }));
    expect(res.ok).toBe(true);
    const st = result.current.state;
    expect(st.status === "ready" && st.lists.some((l) => l.name === "food")).toBe(true);
    const postCall = fetchImpl.mock.calls.find(
      (c) => (c[0] as Request).method === "POST",
    )?.[0] as Request;
    expect(postCall.url).toContain("/item-lists");
  });

  it("surfaces a duplicate name as a failed ActionResult", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, listsBody))
      .mockImplementationOnce(async () =>
        json(409, { code: "duplicate_name", message: "You already have a list with that name." }),
      );
    const { result } = renderHook(() => useItemLists(client));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    const res = await act(async () => result.current.createList({ name: "Travel", boosting: false }));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.message).toContain("already have a list");
    // The lists are still whatever the server last said — the failed create changed nothing.
    expect(result.current.state.status === "ready" && result.current.state.lists.length).toBe(2);
  });

  it("moves the default and refreshes the isDefault marker", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, listsBody))
      .mockImplementationOnce(async () => json(204, undefined))
      .mockImplementationOnce(async () =>
        json(200, {
          items: [{ ...SAVED, isDefault: false }, { ...TRAVEL, isDefault: true }],
          defaultListId: "l2",
        }),
      );
    const { result } = renderHook(() => useItemLists(client));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    const res = await act(async () => result.current.setDefaultList("l2"));
    expect(res.ok).toBe(true);
    expect(result.current.defaultListId).toBe("l2");
    const putCall = fetchImpl.mock.calls[1]?.[0] as Request;
    expect(putCall.method).toBe("PUT");
    expect(putCall.url).toContain("/item-lists/default");
  });

  it("toggles boosting via a partial update", async () => {
    const { client, fetchImpl, json } = fakeClient();
    const bodies: unknown[] = [];
    fetchImpl
      .mockImplementationOnce(async () => json(200, listsBody))
      .mockImplementationOnce(async (req: Request) => {
        bodies.push(await req.json());
        return json(200, { ...TRAVEL, boosting: true });
      })
      .mockImplementationOnce(async () =>
        json(200, { items: [SAVED, { ...TRAVEL, boosting: true }], defaultListId: "l1" }),
      );
    const { result } = renderHook(() => useItemLists(client));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    const res = await act(async () => result.current.updateList("l2", { boosting: true }));
    expect(res.ok).toBe(true);
    expect(bodies[0]).toEqual({ boosting: true });
    const st = result.current.state;
    expect(st.status === "ready" && st.lists[1]?.boosting).toBe(true);
  });

  it("deletes a list and re-reads", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, listsBody))
      .mockImplementationOnce(async () => json(204, undefined))
      .mockImplementationOnce(async () => json(200, { items: [SAVED], defaultListId: "l1" }));
    const { result } = renderHook(() => useItemLists(client));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    const res = await act(async () => result.current.deleteList("l2"));
    expect(res.ok).toBe(true);
    const st = result.current.state;
    expect(st.status === "ready" && st.lists.map((l) => l.id)).toEqual(["l1"]);
    const delCall = fetchImpl.mock.calls[1]?.[0] as Request;
    expect(delCall.method).toBe("DELETE");
    expect(delCall.url).toContain("/item-lists/l2");
  });

  it("removes one item from a list, carrying the item in the query", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, listsBody))
      .mockImplementationOnce(async () => json(204, undefined))
      .mockImplementationOnce(async () => json(200, listsBody));
    const { result } = renderHook(() => useItemLists(client));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    const res = await act(async () =>
      result.current.removeFromList("l2", { itemKind: "vocabulary", itemRef: "990101" }),
    );
    expect(res.ok).toBe(true);
    const delCall = fetchImpl.mock.calls[1]?.[0] as Request;
    expect(delCall.method).toBe("DELETE");
    // The path id AND the query pair must both survive: losing either one
    // would silently aim the DELETE at the wrong list or item.
    expect(delCall.url).toContain("/item-lists/l2/items?itemKind=vocabulary&itemRef=990101");
  });

  it("reads a list's members with their labels, leaving the shared list view alone", async () => {
    const { client, fetchImpl, json } = fakeClient();
    const members = {
      items: [
        { itemKind: "vocabulary", itemRef: "990101", surface: "学校", gloss: "school" },
        { itemKind: "grammar", itemRef: "12", surface: "～てしまう", gloss: "completing something" },
      ],
    };
    fetchImpl
      .mockImplementationOnce(async () => json(200, listsBody))
      .mockImplementationOnce(async () => json(200, members));
    const { result } = renderHook(() => useItemLists(client));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    const res = await act(async () => result.current.listItems("l2"));
    expect(res.ok).toBe(true);
    expect(res.ok === true && res.members).toEqual(members.items);
    const getCall = fetchImpl.mock.calls[1]?.[0] as Request;
    expect(getCall.method).toBe("GET");
    expect(getCall.url).toContain("/item-lists/l2/items");
    // A plain read: no re-fetch of the lists, no state churn.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("turns a failed member read into a failed ActionResult", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, listsBody))
      .mockImplementationOnce(async () => json(404, { code: "not_found", message: "no such list" }));
    const { result } = renderHook(() => useItemLists(client));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    const res = await act(async () => result.current.listItems("gone"));
    expect(res.ok).toBe(false);
    // The shared view still holds the last truth.
    expect(result.current.state.status === "ready" && result.current.state.lists.length).toBe(2);
  });

  it("reports a failed load as an error the screen can retry", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(500, { code: "internal", message: "boom" }))
      .mockImplementationOnce(async () => json(200, listsBody));
    const { result } = renderHook(() => useItemLists(client));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.defaultListId).toBeNull();
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
  });
});
