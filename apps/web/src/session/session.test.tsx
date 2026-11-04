import { act, render } from "@testing-library/react";
import { createApiClient } from "@vjt/api-client";
import { useContext } from "react";
import { describe, expect, it } from "vitest";

import { SessionContext, SessionProvider, type Session } from "./session.tsx";
import type { TokenStorage } from "./tokenStorage.ts";

describe("SessionProvider endedByChoice", () => {
  it("is reset when logout throws, so the next visit still remembers next", async () => {
    let session: Session | null = null;
    function Probe() {
      session = useContext(SessionContext);
      return null;
    }
    const client = createApiClient({
      baseUrl: "http://api.test",
      fetch: async () => Response.json({}, { status: 200 }),
    });
    const tokenStorage: TokenStorage = {
      get: async () => null,
      set: async () => undefined,
      clear: async () => {
        throw new Error("keychain locked");
      },
    };
    render(
      <SessionProvider client={client} tokenStorage={tokenStorage}>
        <Probe />
      </SessionProvider>,
    );
    if (!session) throw new Error("probe did not render");

    await act(async () => {
      await expect((session as Session).logout()).rejects.toThrow("keychain locked");
    });

    expect((session as Session | null)?.endedByChoice).toBe(false);
  });
});
