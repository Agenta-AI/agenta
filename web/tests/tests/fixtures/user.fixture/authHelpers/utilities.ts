import {WorkerInfo} from "@playwright/test"

import {TestEnvironment, type TestEnvironmentType} from "../../../../playwright/config/testTags"
import {getTestmailClient} from "../../../../utils/testmail"
import {UserState} from "../types"

/**
 * Determines the test environment from the project name.
 * The project name is set to AGENTA_LICENSE (ee/oss) in the config.
 * Falls back to "oss" if it doesn't match a known environment key.
 */
export function determineEnvironment(project: Partial<WorkerInfo["project"]>): TestEnvironmentType {
    const projectName = project.name as TestEnvironmentType

    if (Object.keys(TestEnvironment).includes(projectName)) {
        return projectName
    }

    // Project name is a license (ee/oss), not an environment key — default to "local"
    return "local" as TestEnvironmentType
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
    const email = testmail.generateTestEmail({
        scope: project.name,
        branch: process.env.BRANCH_NAME,
    })

    return {
        email,
        isAuthenticated: false,
        environment,
        requiresAuth: true,
        password: "",
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
