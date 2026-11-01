import { createApiClient } from "@vjt/api-client";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

const client = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? "http://localhost:8080",
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App client={client} />
  </StrictMode>,
);
