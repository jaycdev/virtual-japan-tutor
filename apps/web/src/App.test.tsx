import { cleanup, render, screen } from "@testing-library/react";
import { createApiClient } from "@vjt/api-client";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App.tsx";

afterEach(cleanup);

function client(status: number, body: unknown) {
  return createApiClient({
    baseUrl: "http://api.test",
    fetch: async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  });
}

describe("App", () => {
  it("shows the server health as a smoke test", async () => {
    render(<App client={client(200, { status: "ok", database: "connected" })} />);
    expect(await screen.findByText("Server: ok, database: connected")).toBeTruthy();
  });

  it("shows a degraded server", async () => {
    render(<App client={client(503, { status: "degraded", database: "unreachable" })} />);
    expect(await screen.findByText("Server: degraded, database: unreachable")).toBeTruthy();
  });
});
