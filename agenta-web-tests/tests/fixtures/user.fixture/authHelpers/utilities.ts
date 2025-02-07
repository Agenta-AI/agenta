import { WorkerInfo } from "@playwright/test";
import {
  TestEnvironment,
  TestFeatureScope,
  environmentFeatures,
  type TestEnvironmentType,
} from "../../../../playwright/config/testTags";
import { getTestmailClient } from "../../../../utils/testmail";
import { UserState } from "../types";

/**
 * Determines the test environment based on the Playwright worker's project name
 *
 * @param workerInfo - Playwright worker information containing project details
 * @returns The determined environment type (local, local-cloud, staging, beta)
 * @throws Error if project name doesn't match a known environment
 *
 * @example
 * // Worker running with --project local-cloud
 * const env = determineEnvironment(workerInfo);
 * // Returns 'local-cloud' as TestEnvironmentType
 */
export function determineEnvironment(
  workerInfo: WorkerInfo
): TestEnvironmentType {
  const projectName = workerInfo.project.name as TestEnvironmentType;

  if (!Object.keys(TestEnvironment).includes(projectName)) {
    throw new Error(
      `Invalid project name "${projectName}". Must be one of: ${Object.keys(
        TestEnvironment
      ).join(", ")}`
    );
  }

  return projectName;
}

/**
 * Determines if authentication is required based on environment and test tags
 *
 * Authentication is required if either:
 * 1. The environment is a cloud variant (local-cloud, staging, beta)
 * 2. Test has cloud-only feature tag
 * 3. Test has explicit auth scope tag
 *
 * @param environment - Current test environment
 * @param tags - Test tags extracted from test title
 * @returns boolean indicating if authentication is required
 *
 * @example
 * // Check auth requirement for cloud environment
 * const needsAuth = requiresAuthentication('local-cloud', ['@scope:apps']);
 * // Returns true because local-cloud always requires auth
 *
 * // Check auth requirement for OSS with cloud feature
 * const needsAuth = requiresAuthentication('local', ['@feature-scope:cloud-only']);
 * // Returns true because cloud-only feature requires auth
 */
export function requiresAuthentication(
  environment: TestEnvironmentType,
  tags?: string[]
): boolean {
  // Cloud environments always require authentication
  if (environmentFeatures[environment].isCloudVariant) return true;

  // Check tags for auth requirements
  return (
    tags?.some(
      (tag) =>
        tag.includes(`@feature-scope:${TestFeatureScope.CLOUD_ONLY}`) ||
        tag.includes("@scope:auth")
    ) ?? false
  );
}

/**
 * Creates initial user state for a worker
 *
 * Generates a unique email address and sets up initial state based on:
 * - Environment determined from worker info
 * - Default authentication requirement based on environment
 *
 * @param workerInfo - Playwright worker information
 * @returns Initial UserState object
 *
 * @example
 * const userState = createInitialUserState(workerInfo);
 * // Returns {
 * //   email: "abc123@namespace.testmail.app",
 * //   isAuthenticated: false,
 * //   environment: "local-cloud",
 * //   requiresAuth: true
 * // }
 */
export function createInitialUserState(workerInfo: WorkerInfo): UserState {
  const environment = determineEnvironment(workerInfo);
  const testmail = getTestmailClient();

  // Create email with structured tag
  const email = testmail.generateTestEmail({
    scope: workerInfo.project.name,
    workerId: workerInfo.workerIndex,
    branch: process.env.BRANCH_NAME,
  });

  return {
    email,
    isAuthenticated: false,
    environment,
    requiresAuth: environmentFeatures[environment].isCloudVariant,
  };
}

/**
 * Generates a unique test group identifier
 *
 * Used to track test group state and prevent duplicate hooks/logs
 *
 * @param title - Test group title
 * @param workerIndex - Optional worker index for worker-specific grouping
 * @returns Unique group identifier string
 *
 * @example
 * // Simple group ID
 * const id = getTestGroupId('My Test Group');
 * // Returns 'My Test Group'
 *
 * // Worker-specific group ID
 * const id = getTestGroupId('My Test Group', 1);
 * // Returns '1-My Test Group'
 */
export function getTestGroupId(title: string, workerIndex?: number): string {
  return workerIndex !== undefined ? `${workerIndex}-${title}` : title;
}
