import { createApiClient } from "@vjt/api-client";
import { describe, expect, it } from "vitest";
import { SETUP_SEEN_KEY, decideLandingSetup, hasSetupSeen, markSetupSeen, type KeyValueStore } from "./firstRun.ts";

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: async (key) => data[key] ?? null,
    setItem: async (key, value) => {
      data[key] = value;
    },
  };
}

/** A client whose GET /starting-level answers with `reply`; counts the calls. */
function startingLevelClient(reply: () => Response | Promise<Response>) {
  let calls = 0;
  const client = createApiClient({
    baseUrl: "http://api.test",
    fetch: async (req) => {
      if (new URL(req.url).pathname !== "/starting-level" || req.method !== "GET") {
        throw new Error(`unexpected ${req.method} ${req.url}`);
      }
      calls += 1;
      return reply();
    },
  });
  return { client, calls: () => calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("first-run flag", () => {
  it("is unseen until it is marked, and only the exact value counts", async () => {
    const store = memoryStore();
    expect(await hasSetupSeen(store)).toBe(false);
    await markSetupSeen(store);
    expect(store.data[SETUP_SEEN_KEY]).toBe("yes");
    expect(await hasSetupSeen(store)).toBe(true);
    expect(await hasSetupSeen(memoryStore({ [SETUP_SEEN_KEY]: "no" }))).toBe(false);
  });
});

describe("decideLandingSetup", () => {
  it("sends an unconfigured Learner to setup without marking the flag", async () => {
    const store = memoryStore();
    const { client } = startingLevelClient(() => json({ id: "u", username: "a", configured: false }));
    expect(await decideLandingSetup(client, store)).toBe("show-setup");
    expect(store.data[SETUP_SEEN_KEY]).toBeUndefined();
  });

  it("marks an already-configured account as seen and stays put", async () => {
    const store = memoryStore();
    const { client } = startingLevelClient(() => json({ id: "u", username: "a", configured: true }));
    expect(await decideLandingSetup(client, store)).toBe("stay");
    expect(store.data[SETUP_SEEN_KEY]).toBe("yes");
  });

  it("does not ask the server again once the flag is set", async () => {
    const store = memoryStore({ [SETUP_SEEN_KEY]: "yes" });
    const probe = startingLevelClient(() => json({ id: "u", username: "a", configured: false }));
    expect(await decideLandingSetup(probe.client, store)).toBe("stay");
    expect(probe.calls()).toBe(0);
  });

  it("treats a server error as inconclusive: no redirect, no mark", async () => {
    const store = memoryStore();
    const { client } = startingLevelClient(() => json({ message: "boom" }, 500));
    expect(await decideLandingSetup(client, store)).toBe("stay");
    expect(store.data[SETUP_SEEN_KEY]).toBeUndefined();
  });

  it("treats an unreachable server as inconclusive", async () => {
    const store = memoryStore();
    const client = createApiClient({
      baseUrl: "http://api.test",
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(await decideLandingSetup(client, store)).toBe("stay");
    expect(store.data[SETUP_SEEN_KEY]).toBeUndefined();
  });
});
