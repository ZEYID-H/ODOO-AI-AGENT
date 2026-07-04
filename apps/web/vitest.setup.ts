import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Vitest doesn't expose `afterEach` as a global by default (test.globals is
// off in vitest.config.ts), so @testing-library/react's own auto-cleanup
// detection never fires. Register it explicitly here so every component
// test file gets a clean DOM between tests without needing to remember to
// call cleanup() itself.
afterEach(() => {
  cleanup();
});
