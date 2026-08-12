/**
 * Runner subscription-status atoms.
 *
 * Deliberately separate from `harnessCatalogQueryAtom`: the catalog answers what a harness
 * SUPPORTS (static, cacheable, persisted to IndexedDB), this answers what the deployment's runner
 * can use RIGHT NOW (dynamic, short-lived, never persisted).
 *
 * Design: docs/design/runner-subscription-status/api-design.md ("Frontend query", "Frontend display")
 */

import {projectIdAtom} from "@agenta/shared/state"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchSubscriptionStatus, type SubscriptionStatusResponse} from "../api"

/**
 * The family key for a subscription-status query: the harness to check, or `""` to stay idle.
 *
 * Only the `self_managed` connection mode asks the runner anything — under "API key" the harness
 * never reads a local login, so there is nothing to check and nothing to fetch.
 */
export function subscriptionStatusKey({
    mode,
    harness,
}: {
    mode: string | null | undefined
    harness: string | null | undefined
}): string {
    return mode === "self_managed" && harness ? harness : ""
}

/**
 * Live runner status for one harness. Keyed by the harness (`""` = idle, no request).
 *
 * Not persisted: this is a point-in-time check, and a stale "Subscription login found" restored
 * from disk would be a claim we cannot stand behind.
 */
export const subscriptionStatusQueryAtomFamily = atomFamily((harness: string) =>
    atomWithQuery<SubscriptionStatusResponse | null>((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: ["workflows", "runtime", "subscription-status", harness, projectId],
            queryFn: () => fetchSubscriptionStatus({harness, projectId: projectId as string}),
            enabled: !!harness && !!projectId,
            staleTime: 10_000,
            refetchInterval: 15_000,
            refetchOnWindowFocus: true,
        }
    }),
)

export type SubscriptionStatusTone = "neutral" | "success" | "warning" | "error"

/** A display-ready status line. `message: null` means the query is idle — render nothing. */
export interface SubscriptionStatusDisplay {
    message: string | null
    tone: SubscriptionStatusTone
    loading: boolean
}

const IDLE: SubscriptionStatusDisplay = {message: null, tone: "neutral", loading: false}

/** A runner that cannot answer for this harness — an old build, or a state we do not know. */
const UPDATE_RUNNER: SubscriptionStatusDisplay = {
    message: "Update the runner to check subscription status.",
    tone: "warning",
    loading: false,
}

/** Reachability failures: a rejected request, or a payload that failed the boundary schema. */
const CHECK_FAILED: SubscriptionStatusDisplay = {
    message: "Agenta could not check the runner.",
    tone: "error",
    loading: false,
}

const HARNESS_STATE_DISPLAY: Record<string, SubscriptionStatusDisplay> = {
    ready: {message: "Subscription login found", tone: "success", loading: false},
    not_configured: {
        message: "Runner found. Subscription folder is not configured.",
        tone: "warning",
        loading: false,
    },
    login_missing: {
        message: "Runner found. Login file is missing.",
        tone: "warning",
        loading: false,
    },
    login_unusable: {
        message: "Runner found. Login file cannot be used.",
        tone: "error",
        loading: false,
    },
}

/**
 * Map the query state and the runner's answer to the one message the card shows.
 *
 * Never claims the subscription is VERIFIED — the runner checks that a login file exists and has a
 * plausible shape, which says nothing about whether the provider will accept it.
 */
export function resolveSubscriptionStatus({
    harness,
    isLoading,
    isError,
    data,
}: {
    /** The family key (`subscriptionStatusKey`); `""` means the query is idle. */
    harness: string
    isLoading: boolean
    isError: boolean
    data: SubscriptionStatusResponse | null | undefined
}): SubscriptionStatusDisplay {
    if (!harness) return IDLE
    if (isError) return CHECK_FAILED
    if (isLoading || data === undefined)
        return {message: "Checking the runner…", tone: "neutral", loading: true}
    // `null` is the boundary schema's safe fallback — an answer we could not read.
    if (data === null) return CHECK_FAILED

    if (data.runner === "unavailable")
        return {message: "Runner is not connected.", tone: "warning", loading: false}
    if (data.runner === "incompatible") return UPDATE_RUNNER

    const state = data.harnesses?.[harness]?.state
    return (state ? HARNESS_STATE_DISPLAY[state] : undefined) ?? UPDATE_RUNNER
}
