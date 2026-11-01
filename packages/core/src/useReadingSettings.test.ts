import { createApiClient } from "@vjt/api-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useReadingSettings } from "./useReadingSettings.ts";

function fakeClient() {
  const fetchImpl = vi.fn();
  const client = createApiClient({ baseUrl: "http://127.0.0.1:8787", fetch: fetchImpl });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  return { client, fetchImpl, json };
}

describe("useReadingSettings", () => {
  it("loads the stored preferences on mount", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl.mockImplementationOnce(async () =>
      json(200, { blurTranslation: false, lookupHoldMs: 1200 }),
    );
    const { result } = renderHook(() => useReadingSettings(client));

    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    const st = result.current.state;
    expect(st.status === "ready" && st.settings.blurTranslation).toBe(false);
    expect(st.status === "ready" && st.settings.lookupHoldMs).toBe(1200);
    const call = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(call.url).toContain("/reading-settings");
  });

  it("saves a change and keeps the server's answer as the state", async () => {
    const { client, fetchImpl, json } = fakeClient();
    const bodies: unknown[] = [];
    fetchImpl
      .mockImplementationOnce(async () => json(200, { blurTranslation: true, lookupHoldMs: 800 }))
      .mockImplementationOnce(async (req: Request) => {
        const body = await req.json();
        bodies.push(body);
        return json(200, body);
      });
    const { result } = renderHook(() => useReadingSettings(client));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    const res = await act(async () => result.current.setBlurTranslation(false));
    expect(res.ok).toBe(true);
    const st = result.current.state;
    expect(st.status === "ready" && st.settings.blurTranslation).toBe(false);
    const putCall = fetchImpl.mock.calls[1]?.[0] as Request;
    expect(putCall.method).toBe("PUT");
    // The PUT carries the whole settings object: the untouched threshold rides along.
    expect(bodies[0]).toEqual({ blurTranslation: false, lookupHoldMs: 800 });
  });

  it("saves the lookup-hold threshold, keeping the blur preference", async () => {
    const { client, fetchImpl, json } = fakeClient();
    const bodies: unknown[] = [];
    fetchImpl
      .mockImplementationOnce(async () => json(200, { blurTranslation: false, lookupHoldMs: 800 }))
      .mockImplementationOnce(async (req: Request) => {
        const body = await req.json();
        bodies.push(body);
        return json(200, body);
      });
    const { result } = renderHook(() => useReadingSettings(client));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    const res = await act(async () => result.current.setLookupHoldMs(1500));
    expect(res.ok).toBe(true);
    expect(bodies[0]).toEqual({ blurTranslation: false, lookupHoldMs: 1500 });
    const st = result.current.state;
    expect(st.status === "ready" && st.settings.lookupHoldMs).toBe(1500);
  });

  it("reports a failed load as an error the screen can retry", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(500, { code: "internal", message: "boom" }))
      .mockImplementationOnce(async () => json(200, { blurTranslation: true, lookupHoldMs: 800 }));
    const { result } = renderHook(() => useReadingSettings(client));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
  });
});
