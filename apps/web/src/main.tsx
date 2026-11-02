import { createApiClient } from "@vjt/api-client";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { localStorageTokenStorage } from "./tokenStorage.ts";

// A production build is served by the server itself, so the API is the page's own origin
// (empty base URL = relative requests). Set VITE_API_URL to build for a different host;
// `vite dev` has no API on its own origin, so it defaults to a local server.
const baseUrl = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? "" : "http://localhost:8080");

// Created once at module level: useAuth requires stable client/storage references.
const client = createApiClient({ baseUrl });
const storage = localStorageTokenStorage();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App client={client} storage={storage} />
  </StrictMode>,
);
