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
export type ItemKind = components["schemas"]["ItemKind"];
export type PracticeSession = components["schemas"]["PracticeSession"];
export type PracticeSessionStart = components["schemas"]["PracticeSessionStart"];
export type PracticeExercise = components["schemas"]["PracticeExercise"];
export type PracticeOption = components["schemas"]["PracticeOption"];
export type PracticeAnswer = components["schemas"]["PracticeAnswer"];
export type PracticeAnswerResult = components["schemas"]["PracticeAnswerResult"];
export type PracticeState = components["schemas"]["PracticeState"];
export type PracticeResults = components["schemas"]["PracticeResults"];
export type PracticeResultsItem = components["schemas"]["PracticeResultsItem"];
export type Story = components["schemas"]["Story"];
export type StoryPage = components["schemas"]["StoryPage"];
export type StorySentence = components["schemas"]["StorySentence"];
export type StoryToken = components["schemas"]["StoryToken"];
export type StoryQuestion = components["schemas"]["StoryQuestion"];
export type StoryVocabItem = components["schemas"]["StoryVocabItem"];
export type StoryGrammarSpan = components["schemas"]["StoryGrammarSpan"];
export type StoryRating = components["schemas"]["StoryRating"];
export type StorySettings = components["schemas"]["StorySettings"];
export type StoryAnswer = components["schemas"]["StoryAnswer"];
export type StoryAnswerResult = components["schemas"]["StoryAnswerResult"];
export type ReadingSettings = components["schemas"]["ReadingSettings"];
export type DictionaryEntry = components["schemas"]["DictionaryEntry"];
export type DictionarySense = components["schemas"]["DictionarySense"];
export type DictionaryKanji = components["schemas"]["DictionaryKanji"];
export type PitchPattern = components["schemas"]["PitchPattern"];
export type ItemList = components["schemas"]["ItemList"];
export type ItemListsResponse = components["schemas"]["ItemListsResponse"];
export type ItemListCreateRequest = components["schemas"]["ItemListCreateRequest"];
export type ItemListUpdateRequest = components["schemas"]["ItemListUpdateRequest"];
export type ItemListAddRequest = components["schemas"]["ItemListAddRequest"];
export type ItemListMember = components["schemas"]["ItemListMember"];
export type ItemListItemsResponse = components["schemas"]["ItemListItemsResponse"];
export type WeakSignalRequest = components["schemas"]["WeakSignalRequest"];
export type WeakSignalBatchRequest = components["schemas"]["WeakSignalBatchRequest"];
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
