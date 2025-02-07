import type { BaseFixture } from "../base.fixture/types";
import type { TestEnvironmentType } from "../../../playwright/config/testTags";
import type { AuthHelpers } from "./authHelpers/types";

export interface UserState {
  email: string;
  isAuthenticated: boolean;
  environment: TestEnvironmentType;
  requiresAuth: boolean;
}

export interface WorkerFixtures {
  workerState: UserState;
}

export interface TestFixtures extends BaseFixture {
  authHelpers: AuthHelpers;
  user: UserState;
}

// State management types
export type WorkerStateMap = Map<number, UserState>;
export type RegisteredGroupsSet = Set<string>;
