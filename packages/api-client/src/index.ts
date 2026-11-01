import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "./generated/schema.ts";

export type { components, paths };
export type Health = components["schemas"]["Health"];
export type User = components["schemas"]["User"];
export type AiProvider = components["schemas"]["AiProvider"];
export type AiProviderCreate = components["schemas"]["AiProviderCreate"];
export type AiProviderUpdate = components["schemas"]["AiProviderUpdate"];
export type AiProviderTestResult = components["schemas"]["AiProviderTestResult"];
export type AiTask = components["schemas"]["AiTask"];
export type AiTaskAssignment = components["schemas"]["AiTaskAssignment"];
export type MaruMoriStatus = components["schemas"]["MaruMoriStatus"];
export type MaruMoriStatusCounts = components["schemas"]["MaruMoriStatusCounts"];
export type MaruMoriCounts = components["schemas"]["MaruMoriCounts"];
export type MaruMoriKeyRequest = components["schemas"]["MaruMoriKeyRequest"];
export type MaruMoriSyncRun = components["schemas"]["MaruMoriSyncRun"];
export type GrammarJLPTLevel = components["schemas"]["GrammarJLPTLevel"];
export type GrammarPointSummary = components["schemas"]["GrammarPointSummary"];
export type GrammarPointPage = components["schemas"]["GrammarPointPage"];
export type GrammarExample = components["schemas"]["GrammarExample"];
export type GrammarPointDetail = components["schemas"]["GrammarPointDetail"];
export type CandidateRejection = components["schemas"]["CandidateRejection"];
export type GenerationResult = components["schemas"]["GenerationResult"];
export type StartingLevelStatus = components["schemas"]["StartingLevelStatus"];
export type StartingLevelUpdate = components["schemas"]["StartingLevelUpdate"];
export type GrammarReviewItem = components["schemas"]["GrammarReviewItem"];
export type FocusSet = components["schemas"]["FocusSet"];
export type FocusSetItem = components["schemas"]["FocusSetItem"];
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
