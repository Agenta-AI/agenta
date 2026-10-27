// Create, poll, and cancel one device login. The poll terminates on the SERVER's state.
// Design: docs/design/hosted-subscription-connections/implementation-contract.md §4.

import {getHostQueryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {setSubscriptionToken} from "../api/api"
import {
    LOGIN_ATTEMPT_BACKSTOP_MS,
    MIN_LOGIN_POLL_MS,
    cancelLoginAttempt,
    fetchLoginAttempt,
    isTerminalLoginAttemptState,
    startLoginAttempt,
    type LoginAttemptResponse,
    type LoginAttemptScope,
} from "../api/loginAttempts"
import {createOrganizationSecret, type OrganizationSecretProjects} from "../api/organizationSecrets"
import {SUBSCRIPTION_PROVIDER_KIND} from "../core/subscriptionConnections"
import type {CreateSecretDto} from "../core/types"

import {createVaultSecretMutationAtom} from "./atoms"

/** Which attempt a poll addresses: an attempt is polled through its own connection. */
export interface LoginAttemptKey {
    secretId: string
    attemptId: string
    /** When the poll started, so the backstop can stop a server that answers `pending` forever. */
    startedAt: number
    /** Whose connection it is; an organization login is polled with its scope. */
    scope?: LoginAttemptScope
}

// A string, because `atomFamily` dedupes by value: an object would make a poll per render.
export const loginAttemptKey = ({secretId, attemptId, startedAt, scope}: LoginAttemptKey): string =>
    [secretId, attemptId, startedAt, ...(scope === "organization" ? [scope] : [])].join("|")

const parseLoginAttemptKey = (serialized: string): LoginAttemptKey | null => {
    const [secretId, attemptId, startedAt, scope] = serialized.split("|")
    if (!secretId || !attemptId) return null
    return {
        secretId,
        attemptId,
        startedAt: Number(startedAt) || 0,
        ...(scope === "organization" ? {scope} : {}),
    }
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
                    scope: key.scope,
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
        // An empty name is left to the API, which names the row after its owner.
        header: name ? {name} : {},
        secret: {kind: SUBSCRIPTION_PROVIDER_KIND, data: {provider}},
    }) as unknown as CreateSecretDto

/**
 * Create the subscription connection. Returns its record id. With `organization`, the
 * organization's login, for the projects it names.
 */
export const createSubscriptionConnectionAtom = atom(
    null,
    async (
        get,
        _set,
        {
            provider,
            name,
            organization,
        }: {provider: string; name: string; organization?: {projects: OrganizationSecretProjects}},
    ): Promise<string> => {
        const projectId = get(projectIdAtom)
        if (!projectId)
            throw new Error("[vault] Missing projectId for createSubscriptionConnection")

        const payload = buildSubscriptionSecretPayload(provider, name)
        const created = organization
            ? await createOrganizationSecret({projectId, payload, projects: organization.projects})
            : await get(createVaultSecretMutationAtom).mutateAsync({projectId, payload})
        const id = created.id
        if (!id) throw new Error("[vault] The subscription connection was created without an id")
        return id
    },
)

/** Start a device login on a connection, and return the attempt the card renders. */
export const startSubscriptionLoginAtom = atom(
    null,
    async (
        get,
        _set,
        {secretId, scope}: {secretId: string; scope?: LoginAttemptScope},
    ): Promise<LoginAttemptResponse> => {
        const projectId = get(projectIdAtom)
        if (!projectId) throw new Error("[vault] Missing projectId for startSubscriptionLogin")

        const attempt = await startLoginAttempt({projectId, secretId, scope})
        if (!attempt) throw new Error("[vault] The sign-in did not start. Try again.")
        return attempt
    },
)

/** Store a pasted token on a connection. Throws the API's refusal when the provider rejects it. */
export const setSubscriptionTokenAtom = atom(
    null,
    async (
        get,
        set,
        {secretId, token, scope}: {secretId: string; token: string; scope?: LoginAttemptScope},
    ): Promise<void> => {
        const projectId = get(projectIdAtom)
        if (!projectId) throw new Error("[vault] Missing projectId for setSubscriptionToken")

        await setSubscriptionToken({projectId, secretId, token, scope})
        await set(refreshVaultSecretsAtom)
    },
)

/** Abandon a device login. A failure here is not the user's problem: the attempt expires anyway. */
export const cancelSubscriptionLoginAtom = atom(
    null,
    async (
        get,
        _set,
        {
            secretId,
            attemptId,
            scope,
        }: {secretId: string; attemptId: string; scope?: LoginAttemptScope},
    ) => {
        const projectId = get(projectIdAtom)
        if (!projectId) return
        try {
            await cancelLoginAttempt({projectId, secretId, attemptId, scope})
        } catch (error) {
            console.warn("[vault] Could not cancel the subscription sign-in:", error)
        }
    },
)

/**
 * Refetch both connection lists, so a change shows on the settings tabs and in every picker in
 * one step. The organization read runs in parallel (a member's answers a fast 403).
 */
export const refreshVaultSecretsAtom = atom(null, async () => {
    const queryClient = getHostQueryClient()
    await Promise.all([
        queryClient.invalidateQueries({queryKey: ["vault", "secrets"]}),
        queryClient.invalidateQueries({queryKey: ["vault", "organization-secrets"]}),
    ])
})
