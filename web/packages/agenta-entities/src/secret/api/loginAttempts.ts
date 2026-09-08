// Subscription device login. TODO: move onto the Fern client once it carries these routes.
// Design: docs/design/hosted-subscription-connections/implementation-contract.md §2.

import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {z} from "zod"

import {safeParseWithLogging} from "../../shared"

/** The states an attempt can report. Only `pending` keeps the poll running. */
export const LOGIN_ATTEMPT_STATES = [
    "pending",
    "succeeded",
    "failed",
    "expired",
    "cancelled",
] as const
export type LoginAttemptState = (typeof LOGIN_ATTEMPT_STATES)[number]

export const isTerminalLoginAttemptState = (state: string | null | undefined): boolean =>
    !!state && state !== "pending"

// The poll floor: the device code spec answers slow-down, so faster than asked never helps.
export const MIN_LOGIN_POLL_MS = 2000

/** The attempt is abandoned after this long even if the server keeps answering `pending`. */
export const LOGIN_ATTEMPT_BACKSTOP_MS = 15 * 60 * 1000

const loginAttemptSchema = z.object({
    attempt_id: z.string(),
    state: z.string(),
    user_code: z.string().nullish(),
    verification_uri: z.string().nullish(),
    expires_at: z.string().nullish(),
    poll_after_ms: z.number().nullish(),
    error: z.string().nullish(),
})

export type LoginAttemptResponse = z.infer<typeof loginAttemptSchema>

const attemptsUrl = (secretId: string): string =>
    `${getAgentaApiUrl()}/secrets/${encodeURIComponent(secretId)}/login-attempts`

/** Start a device login, or return the unexpired attempt this connection is already waiting on. */
export async function startLoginAttempt({
    projectId,
    secretId,
}: {
    projectId: string
    secretId: string
}): Promise<LoginAttemptResponse | null> {
    const response = await axios.post(attemptsUrl(secretId), {}, {params: {project_id: projectId}})
    return safeParseWithLogging(loginAttemptSchema, response.data, "[startLoginAttempt]")
}

/** Advance an attempt: this GET asks the runner every time, which is what stores the login. */
export async function fetchLoginAttempt({
    projectId,
    secretId,
    attemptId,
}: {
    projectId: string
    secretId: string
    attemptId: string
}): Promise<LoginAttemptResponse | null> {
    const response = await axios.get(`${attemptsUrl(secretId)}/${encodeURIComponent(attemptId)}`, {
        params: {project_id: projectId},
    })
    return safeParseWithLogging(loginAttemptSchema, response.data, "[fetchLoginAttempt]")
}

/** Abandon an attempt so the runner stops holding it open. */
export async function cancelLoginAttempt({
    projectId,
    secretId,
    attemptId,
}: {
    projectId: string
    secretId: string
    attemptId: string
}): Promise<LoginAttemptResponse | null> {
    const response = await axios.post(
        `${attemptsUrl(secretId)}/${encodeURIComponent(attemptId)}/cancel`,
        {},
        {params: {project_id: projectId}},
    )
    return safeParseWithLogging(loginAttemptSchema, response.data, "[cancelLoginAttempt]")
}
