/**
 * Hosted subscription sign-in — state for the ChatGPT card.
 *
 * Three pieces: the atom that creates the vault record when the project has none, the poll that
 * advances one device login attempt, and the cancel.
 *
 * The poll is an `atomFamily` keyed by attempt id (several attempts can never overlap on one
 * connection, but a project with two connections gets two independent polls), it terminates on the
 * SERVER's state rather than on a client signal, and it refetches neither on focus nor on
 * reconnect — the device code specification defines a slow-down answer, so an extra request costs
 * more than it buys. Copied from `evaluationRunQueryAtomFamily`
 * (`web/oss/src/components/EvalRunDetails/atoms/table/run.ts`).
 *
 * Design: docs/design/hosted-subscription-connections/implementation-contract.md §4.
 */

import {getHostQueryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {
    LOGIN_ATTEMPT_BACKSTOP_MS,
    MIN_LOGIN_POLL_MS,
    cancelLoginAttempt,
    fetchLoginAttempt,
    isTerminalLoginAttemptState,
    startLoginAttempt,
    type LoginAttemptResponse,
} from "../api/loginAttempts"
import {SUBSCRIPTION_PROVIDER_KIND} from "../core/subscriptionConnections"
import type {CreateSecretDto} from "../core/types"

import {createVaultSecretMutationAtom} from "./atoms"

/** Which attempt a poll addresses. Both halves are needed: an attempt is polled through its own connection. */
export interface LoginAttemptKey {
    secretId: string
    attemptId: string
    /** When the poll started, so the backstop can stop a server that answers `pending` forever. */
    startedAt: number
}

/**
 * The family's parameter, as one string.
 *
 * `atomFamily` deduplicates by value, so the key has to BE the value — an object parameter would
 * make a fresh poll on every render. `|` separates: a secret id is a uuid and an attempt id carries
 * no pipe.
 */
export const loginAttemptKey = ({secretId, attemptId, startedAt}: LoginAttemptKey): string =>
    `${secretId}|${attemptId}|${startedAt}`

const parseLoginAttemptKey = (serialized: string): LoginAttemptKey | null => {
    const [secretId, attemptId, startedAt] = serialized.split("|")
    if (!secretId || !attemptId) return null
    return {secretId, attemptId, startedAt: Number(startedAt) || 0}
}

/**
 * The interval a poll should use next, given what the server last answered.
 *
 * Pulled out of the query options so the termination rules are testable without a query client:
 * `false` means stop, a number means poll again after that many milliseconds.
 */
export const loginAttemptPollInterval = ({
    state,
    pollAfterMs,
    startedAt,
    now = Date.now(),
}: {
    state?: string | null
    pollAfterMs?: number | null
    startedAt?: number
    now?: number
}): number | false => {
    if (isTerminalLoginAttemptState(state)) return false
    if (startedAt && now - startedAt > LOGIN_ATTEMPT_BACKSTOP_MS) return false
    return Math.max(pollAfterMs ?? MIN_LOGIN_POLL_MS, MIN_LOGIN_POLL_MS)
}

/**
 * Whether a failed poll means the ATTEMPT is gone, rather than that the request failed.
 *
 * Only a 404 says the server no longer knows this attempt, which is the recoverable ending. A
 * network failure, a 502, or a 500 says nothing about the attempt at all: the sign-in may still
 * be redeemable, so the poll keeps running. Reading every error as "gone" turned one dropped
 * request into an abandoned sign-in.
 */
const attemptIsGone = (error: unknown): boolean =>
    (error as {response?: {status?: number}} | null)?.response?.status === 404

/**
 * What a card should DO about an attempt, given the last poll and the clock.
 *
 * The poll answers three ways and the clock answers a fourth, and each needs a different move, so
 * the choice lives here rather than in a component's effects — beside `loginAttemptPollInterval`,
 * which stops the poll on the same backstop.
 *
 * `unreadable` comes first because it is the recoverable one: a sign-in whose response was lost has
 * already landed on the row, and the next poll reads 404 exactly like a stranger's attempt id. The
 * caller asks the vault instead of showing a failure.
 */
export type LoginAttemptOutcome = "waiting" | "succeeded" | "failed" | "unreadable" | "timed_out"

export const loginAttemptOutcome = ({
    state,
    error = null,
    startedAt,
    now = Date.now(),
}: {
    state?: string | null
    /** What the last poll threw, if it threw. Only a 404 ends the attempt. */
    error?: unknown
    startedAt?: number
    now?: number
}): LoginAttemptOutcome => {
    if (attemptIsGone(error)) return "unreadable"
    if (state === "succeeded") return "succeeded"
    if (isTerminalLoginAttemptState(state)) return "failed"
    if (startedAt && now - startedAt >= LOGIN_ATTEMPT_BACKSTOP_MS) return "timed_out"
    return "waiting"
}

/**
 * The live state of one device login attempt.
 *
 * Refetches at the interval the server asked for, stops the moment the server reports a terminal
 * state, and stops again at the 15 minute backstop.
 */
export const loginAttemptQueryAtomFamily = atomFamily((serialized: string) =>
    atomWithQuery<LoginAttemptResponse | null>((get) => {
        const projectId = get(projectIdAtom)
        const key = parseLoginAttemptKey(serialized)

        return {
            queryKey: ["vault", "login-attempt", serialized, projectId],
            enabled: Boolean(key && projectId),
            staleTime: 0,
            gcTime: 60_000,
            retry: false,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            refetchInterval: (query) =>
                loginAttemptPollInterval({
                    state: query.state.data?.state,
                    pollAfterMs: query.state.data?.poll_after_ms,
                    startedAt: key?.startedAt,
                }),
            queryFn: async () => {
                if (!key) throw new Error("loginAttemptQueryAtomFamily requires an attempt")
                if (!projectId) throw new Error("loginAttemptQueryAtomFamily requires a project id")
                return fetchLoginAttempt({
                    projectId,
                    secretId: key.secretId,
                    attemptId: key.attemptId,
                })
            },
        }
    }),
)

/** Drop a finished attempt's poll, so a cancelled card leaves nothing running behind it. */
export const forgetLoginAttemptAtom = atom(null, (_get, _set, serialized: string) => {
    loginAttemptQueryAtomFamily.remove(serialized)
})

/**
 * The vault payload for a new subscription connection.
 *
 * Header name and provider only. Models, harnesses, and the sign-in state are the API's to fill —
 * the plan fixes the model list, and a browser must not get to state which harnesses may run it.
 */
export const buildSubscriptionSecretPayload = (provider: string, name: string): CreateSecretDto =>
    ({
        header: {name},
        secret: {kind: SUBSCRIPTION_PROVIDER_KIND, data: {provider}},
    }) as unknown as CreateSecretDto

/** Create the subscription connection. Returns its record id. */
export const createSubscriptionConnectionAtom = atom(
    null,
    async (get, _set, {provider, name}: {provider: string; name: string}): Promise<string> => {
        const projectId = get(projectIdAtom)
        if (!projectId)
            throw new Error("[vault] Missing projectId for createSubscriptionConnection")

        const created = await get(createVaultSecretMutationAtom).mutateAsync({
            projectId,
            payload: buildSubscriptionSecretPayload(provider, name),
        })
        const id = created.id
        if (!id) throw new Error("[vault] The subscription connection was created without an id")
        return id
    },
)

/** Start a device login on a connection, and return the attempt the card renders. */
export const startSubscriptionLoginAtom = atom(
    null,
    async (get, _set, {secretId}: {secretId: string}): Promise<LoginAttemptResponse> => {
        const projectId = get(projectIdAtom)
        if (!projectId) throw new Error("[vault] Missing projectId for startSubscriptionLogin")

        const attempt = await startLoginAttempt({projectId, secretId})
        if (!attempt) throw new Error("[vault] The sign-in did not start. Try again.")
        return attempt
    },
)

/** Abandon a device login. A failure here is not the user's problem: the attempt expires anyway. */
export const cancelSubscriptionLoginAtom = atom(
    null,
    async (get, _set, {secretId, attemptId}: {secretId: string; attemptId: string}) => {
        const projectId = get(projectIdAtom)
        if (!projectId) return
        try {
            await cancelLoginAttempt({projectId, secretId, attemptId})
        } catch (error) {
            console.warn("[vault] Could not cancel the subscription sign-in:", error)
        }
    },
)

/** Refetch the vault so a finished sign-in flips the card and the pickers in one step. */
export const refreshVaultSecretsAtom = atom(null, async () => {
    await getHostQueryClient().invalidateQueries({queryKey: ["vault", "secrets"]})
})
