import {WorkerInfo} from "@playwright/test"

import {TestEnvironment, type TestEnvironmentType} from "../../../../playwright/config/testTags"
import {getTestmailClient} from "../../../../utils/testmail"
import {UserState} from "../types"

/**
 * Determines the test environment based on the Playwright worker's project name
 *
 * @param workerInfo - Playwright worker information containing project details
 * @returns The determined environment type (local, staging, beta, oss)
 * @throws Error if project name doesn't match a known environment
 */
export function determineEnvironment(project: Partial<WorkerInfo["project"]>): TestEnvironmentType {
    const projectName = project.name as TestEnvironmentType

    if (!Object.keys(TestEnvironment).includes(projectName)) {
        throw new Error(
            `Invalid project name "${projectName}". Must be one of: ${Object.keys(
                TestEnvironment,
            ).join(", ")}`,
        )
    }

    return projectName
}

/**
 * @deprecated will be removed in a future release since both ee and oss now require authentication
 * Determines if authentication is required based on environment and test tags
 */
export function requiresAuthentication(environment: TestEnvironmentType, tags?: string[]): boolean {
    return true
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
 * //   environment: "staging",
 * //   requiresAuth: true
 * // }
 */
export function createInitialUserState(project: Partial<WorkerInfo["project"]>): UserState {
    const environment = determineEnvironment(project)
    const testmail = getTestmailClient()

    // Create email with structured tag
    const email =
        process.env.LICENSE === "oss" && process.env.AGENTA_OSS_OWNER_EMAIL
            ? process.env.AGENTA_OSS_OWNER_EMAIL
            : testmail.generateTestEmail({
                  scope: project.name,
                  branch: process.env.BRANCH_NAME,
              })

    return {
        email,
        isAuthenticated: false,
        environment,
        requiresAuth: true,
        password: process.env.LICENSE === "oss" ? process.env.AGENTA_OSS_OWNER_PASSWORD : "",
    }
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
    return workerIndex !== undefined ? `${workerIndex}-${title}` : title
}
