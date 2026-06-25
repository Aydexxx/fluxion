import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { MotionGlobalConfig } from "framer-motion";

// Resolve framer-motion animations instantly so enter/exit don't leave elements
// stuck at their initial (opacity:0) state or linger through exit in jsdom.
MotionGlobalConfig.skipAnimations = true;

// jsdom has no matchMedia; framer-motion's useReducedMotion relies on it.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

afterEach(() => cleanup());
