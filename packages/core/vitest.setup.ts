import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// `globals` is off, so Testing Library cannot register its own cleanup. Without it
// rendered hooks stay mounted and React can schedule work after the environment is
// torn down ("window is not defined").
afterEach(cleanup);
