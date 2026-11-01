import { describe, expect, it } from "vitest";
import { createApiClient } from "./index.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createApiClient", () => {
  it("calls GET /health on the configured base URL and returns typed data", async () => {
    const seen: string[] = [];
    const client = createApiClient({
      baseUrl: "http://api.test",
      fetch: async (req) => {
        seen.push(`${req.method} ${req.url}`);
        return jsonResponse(200, { status: "ok", database: "connected" });
      },
    });

    const { data, response } = await client.GET("/health");

    expect(seen).toEqual(["GET http://api.test/health"]);
    expect(response.status).toBe(200);
    expect(data).toEqual({ status: "ok", database: "connected" });
  });

  it("exposes the 503 body when the database is unreachable", async () => {
    const client = createApiClient({
      baseUrl: "http://api.test",
      fetch: async () => jsonResponse(503, { status: "degraded", database: "unreachable" }),
    });

    const { data, error, response } = await client.GET("/health");

    expect(response.status).toBe(503);
    expect(data).toBeUndefined();
    expect(error).toEqual({ status: "degraded", database: "unreachable" });
  });
});
