import { Page } from "@playwright/test";
import type { BaseFixture } from "../../base.fixture/types";

export interface AuthHelpers {
  loginWithEmail: (email: string, options?: LoginOptions) => Promise<void>;
  completePostSignup: () => Promise<void>;
  completeLLMKeysCheck: () => Promise<void>;
}

export type AuthHelperFactory = (context: BaseFixture) => AuthHelpers;

export interface LoginOptions {
  timeout?: number;
  inputDelay?: number;
}

export interface AuthResponse {
  status: string;
  user: {
    id: string;
    isPrimaryUser: boolean;
    tenantIds: string[];
    emails: string[];
    loginMethods: Array<{
      recipeId: string;
      recipeUserId: string;
      timeJoined: number;
      verified: boolean;
    }>;
    timeJoined: number;
  };
  createdNewRecipeUser: boolean;
}

export type LoginWithEmailFn = (
  email: string,
  options?: LoginOptions
) => Promise<void>;

export type PostSignupFn = () => Promise<void>;
