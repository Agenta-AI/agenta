import type { BrowserContext } from "@playwright/test";

export interface SessionState {
  context?: BrowserContext;
  isAuthenticated: boolean;
}

export interface SessionFixtures {
  session: SessionState;
  useSharedContext: boolean;
}

export interface SessionWorkerFixtures {
  sessionState: SessionState;
}
