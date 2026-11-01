import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "./generated/schema.ts";

export type { components, paths };
export type Health = components["schemas"]["Health"];
export type User = components["schemas"]["User"];
export type ApiMiddleware = Middleware;

export interface ApiClientOptions {
  baseUrl: string;
  /** Override fetch (tests, custom runtimes). Defaults to the global fetch. */
  fetch?: (request: Request) => Promise<Response>;
}

export function createApiClient(options: ApiClientOptions) {
  return createClient<paths>(options);
}

export type ApiClient = ReturnType<typeof createApiClient>;
