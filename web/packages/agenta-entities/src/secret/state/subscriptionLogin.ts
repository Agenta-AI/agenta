// Create, poll, and cancel one device login. The poll terminates on the SERVER's state.
// Design: docs/design/hosted-subscription-connections/implementation-contract.md §4.

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

/** Which attempt a poll addresses: an attempt is polled through its own connection. */
export interface LoginAttemptKey {
    secretId: string
    attemptId: string
    /** When the poll started, so the backstop can stop a server that answers `pending` forever. */
    startedAt: number
}

// A string, because `atomFamily` dedupes by value: an object would make a poll per render.
export const loginAttemptKey = ({secretId, attemptId, startedAt}: LoginAttemptKey): string =>
    `${secretId}|${attemptId}|${startedAt}`

const parseLoginAttemptKey = (serialized: string): LoginAttemptKey | null => {
    const [secretId, attemptId, startedAt] = serialized.split("|")
    if (!secretId || !attemptId) return null
    return {secretId, attemptId, startedAt: Number(startedAt) || 0}
}

/** The next interval, or `false` to stop. Outside the query options so it is testable. */
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

// Only a 404 says the attempt is gone; every other failure leaves it redeemable, so keep polling.
const attemptIsGone = (error: unknown): boolean =>
    (error as {response?: {status?: number}} | null)?.response?.status === 404

// What a card should DO, on the same backstop the poll stops on. `unreadable` wins: it recovers.
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

/** One attempt's live state: the server's interval, its terminal state, and the backstop. */
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

// Name and provider only: a browser must not get to state which harnesses may run it.
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
