import { createApiClient } from "@vjt/api-client";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { localStorageTokenStorage } from "./tokenStorage.ts";

// Created once at module level: useAuth requires stable client/storage references.
const client = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? "http://localhost:8080",
});
const storage = localStorageTokenStorage();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App client={client} storage={storage} />
  </StrictMode>,
);
