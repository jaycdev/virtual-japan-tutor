import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { createApiClient } from "@vjt/api-client";

import { appRoutes } from "./appRoutes.tsx";
import { SessionBoundary, SessionProvider } from "./session/session.tsx";
import { localTokenStorage } from "./session/tokenStorage.ts";
import { themeStore } from "./theme/index.ts";
import { storyTextSizeStore } from "./storysize/index.ts";
import { japaneseFontStore } from "./japaneseFont/index.ts";

// One client for the page's life. The API is on this origin (in production the
// Go server serves both; in development Vite proxies the API paths), so the
// base URL is simply the page's own origin.
const client = createApiClient({ baseUrl: window.location.origin });
const tokenStorage = localTokenStorage();
const router = createBrowserRouter(appRoutes);

// Read the saved preferences before the first render, so the Appearance settings
// never show a default that is about to change. The no-flash script has already
// set the theme class; this only loads the stores.
void Promise.all([themeStore.hydrate(), storyTextSizeStore.hydrate(), japaneseFontStore.hydrate()]).then(() => {
  const container = document.getElementById("root");
  if (!container) throw new Error("index.html has no #root element");
  createRoot(container).render(
    <StrictMode>
      <SessionProvider client={client} tokenStorage={tokenStorage}>
        <SessionBoundary>
          <RouterProvider router={router} />
        </SessionBoundary>
      </SessionProvider>
    </StrictMode>,
  );
});
