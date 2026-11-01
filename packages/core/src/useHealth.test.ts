import { renderHook, waitFor } from "@testing-library/react";
import { createApiClient } from "@vjt/api-client";
import { describe, expect, it } from "vitest";
import { useHealth } from "./index.ts";

function clientReturning(status: number, body: unknown) {
  return createApiClient({
    baseUrl: "http://api.test",
    fetch: async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  });
}

describe("useHealth", () => {
  it("starts loading, then reports ok when the database is connected", async () => {
    const { result } = renderHook(() =>
      useHealth(clientReturning(200, { status: "ok", database: "connected" })),
    );
    expect(result.current).toEqual({ state: "loading" });
    await waitFor(() =>
      expect(result.current).toEqual({
        state: "ok",
        health: { status: "ok", database: "connected" },
      }),
    );
  });

  it("reports degraded when the server says the database is unreachable", async () => {
    const { result } = renderHook(() =>
      useHealth(clientReturning(503, { status: "degraded", database: "unreachable" })),
    );
    await waitFor(() =>
      expect(result.current).toEqual({
        state: "degraded",
        health: { status: "degraded", database: "unreachable" },
      }),
    );
  });

  it("reports an error when the server cannot be reached at all", async () => {
    const client = createApiClient({
      baseUrl: "http://api.test",
      fetch: async () => {
        throw new TypeError("network down");
      },
    });
    const { result } = renderHook(() => useHealth(client));
    await waitFor(() => expect(result.current.state).toBe("error"));
  });
});
