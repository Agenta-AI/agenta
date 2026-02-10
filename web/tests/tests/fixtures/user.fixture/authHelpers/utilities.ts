import {WorkerInfo} from "@playwright/test"

import {getTestmailClient} from "../../../../utils/testmail"
import {UserState} from "../types"

/**
 * Creates initial user state for a worker
 *
 * Generates a unique email address and sets up initial state.
 * All tests now require authentication.
 *
 * @param project - Playwright project information
 * @returns Initial UserState object
 *
 * @example
 * const userState = createInitialUserState(project);
 * // Returns {
 * //   email: "abc123@namespace.testmail.app",
 * //   isAuthenticated: false,
 * //   requiresAuth: true
 * // }
 */
export function createInitialUserState(project: Partial<WorkerInfo["project"]>): UserState {
    const testmail = getTestmailClient()

    // Create email with structured tag
    const email = testmail.generateTestEmail({
        scope: project.name,
        branch: process.env.BRANCH_NAME,
    })

    return {
        email,
        isAuthenticated: false,
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
