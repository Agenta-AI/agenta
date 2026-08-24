import type {SessionExpansion, SessionListFilters, SessionStream} from "@agenta/entities/session"

import {sessionAgentId} from "../row/sessionAgent"
import {isAutomationSession} from "../row/sessionTrigger"

export type SessionOriginPolicy = "all" | "exclude-trigger" | "trigger-only"

export interface SessionListRequestPolicy {
    origin: SessionOriginPolicy
    expansions: readonly SessionExpansion[]
}

export const sessionListRequestFilters = (
    policy: SessionListRequestPolicy,
): Pick<SessionListFilters, "origins" | "excludeOrigins" | "expand"> => ({
    origins: policy.origin === "trigger-only" ? ["trigger"] : undefined,
    excludeOrigins: policy.origin === "exclude-trigger" ? ["trigger"] : undefined,
    expand: [...policy.expansions],
})

export const selectedSessionListPolicy = (
    automationMode: boolean,
    defaultPolicy: SessionListRequestPolicy,
    automationPolicy: SessionListRequestPolicy,
): SessionListRequestPolicy => (automationMode ? automationPolicy : defaultPolicy)

/**
 * Has this session started? The stream row exists from the runtime's first beat — before anyone
 * types — so a list of every row fills with "Untitled session / No agent yet" placeholders for
 * chats that were only opened. Started means the row carries something a person can recognise it
 * by: a turn (the server attaches the latest turn's `references`, absent until there is one), a
 * title, a message preview, or an automation identity (a trigger row IS its schedule, and the
 * automations list must never blank).
 *
 * Display-only. Callers filter what they RENDER; nothing here may narrow a cached set the sidebar
 * reconciler reads, which drops locally-known sessions the server omits.
 */
export const isStartedSession = (row: SessionStream): boolean =>
    Boolean(
        (row.references?.length ?? 0) > 0 ||
        row.name?.trim() ||
        row.last_message ||
        row.origin === "trigger" ||
        row.trigger,
    )

export const startedSessions = <T extends SessionStream>(rows: readonly T[]): T[] =>
    rows.filter(isStartedSession)

/**
 * Can this row be opened? Its destination is the agent id its references name (`sessionAgentId`),
 * and a row that names none renders inert: the title button disables and the click does nothing.
 *
 * Display-only, like `isStartedSession`.
 */
export const isOpenableSession = (row: SessionStream): boolean => sessionAgentId(row) !== null

/**
 * Drops rows that would render inert — the browsing rule, for rows nobody asked for by name.
 *
 * Automation rows stay whether or not they can be opened, the same exemption `isStartedSession`
 * gives them. A trigger row IS its schedule: it has a name, an identity and its own menu before
 * its first turn ever lands, and the automations list must never blank.
 */
export const openableSessions = <T extends SessionStream>(rows: readonly T[]): T[] =>
    rows.filter((row) => isOpenableSession(row) || hasAutomationIdentity(row))

/** The automation carve-out, on the same two signals `isStartedSession` accepts. */
const hasAutomationIdentity = (row: SessionStream): boolean =>
    isAutomationSession(row) || Boolean(row.trigger)

/**
 * Which display rules each list group applies. `main` is browsing, so it hides chats nobody
 * started and rows with nowhere to open.
 *
 * `pinned` and `waiting` apply neither: both hold rows someone asked for by name, where a missing
 * row reads as a fault rather than as tidiness. A pin that silently vanishes reads as data loss,
 * and hiding an approval-gated row asks its owner to approve a tool call they cannot see. An inert
 * row is the lesser harm in both.
 */
export const sessionGroupRows = <T extends SessionStream>(
    group: "main" | "pinned" | "waiting",
    rows: readonly T[],
): T[] => (group === "main" ? openableSessions(startedSessions(rows)) : [...rows])

/**
 * Is the list still waiting on a top-up? A page is 30 rows and unstarted ones are the NEWEST, so a
 * burst of opened-but-unused chats can fill the whole first page — hiding them would otherwise
 * leave a "No sessions yet" over a list that has plenty, one click down.
 *
 * Stays true for the WHOLE top-up, including while the request is in flight, so the list holds its
 * loading state instead of flashing the empty one. A failed page ends the wait: `hasNextPage` is
 * still true after a failure, so without this the list would wait forever on a page that never lands.
 */
export const awaitingHiddenRows = ({
    visibleRows,
    hasNextPage,
    isError = false,
}: {
    visibleRows: number
    hasNextPage: boolean
    isError?: boolean
}): boolean => visibleRows === 0 && hasNextPage && !isError

/**
 * The narrower "fire the request now" edge: only when nothing is already in flight, and never after
 * a failure — `fetchNextPage` failing leaves `hasNextPage` true, so retrying on it would spin.
 */
export const shouldLoadMoreForHiddenRows = ({
    visibleRows,
    hasNextPage,
    isFetchingNextPage,
    isError = false,
}: {
    visibleRows: number
    hasNextPage: boolean
    isFetchingNextPage: boolean
    isError?: boolean
}): boolean => awaitingHiddenRows({visibleRows, hasNextPage, isError}) && !isFetchingNextPage

export const sessionListIdGroupLimit = (
    sessionIds: readonly string[] | undefined,
    requestedLimit: number | undefined,
): number | undefined => {
    if (sessionIds === undefined) return requestedLimit
    return Math.max(1, requestedLimit ?? 0, new Set(sessionIds).size)
}

/**
 * The canonical per-surface list policies. Extracted from the app layer so mobile and oss ask
 * the backend for the same rows — a surface that hand-rolls its own origin filter is how the two
 * apps drift apart.
 */
export const sessionListPolicies = {
    homeHuman: {origin: "exclude-trigger", expansions: ["last_message"]},
    homeAutomation: {origin: "trigger-only", expansions: ["last_message", "trigger"]},
    sessionsDefault: {origin: "exclude-trigger", expansions: ["last_message"]},
    sessionsAutomation: {origin: "trigger-only", expansions: ["last_message", "trigger"]},
    agentOverviewHuman: {origin: "exclude-trigger", expansions: []},
    // Trigger names resolve automation rows to their schedule/subscription name (falling back to
    // the historical name once deleted) — without it every row reads "Missing schedule". No
    // `last_message`: this surface intentionally never requests message previews.
    agentOverviewAutomation: {origin: "trigger-only", expansions: ["trigger"]},
    sidebar: {origin: "exclude-trigger", expansions: []},
    // A pin is an explicit user request and overrides the sidebar's origin filter — a pinned
    // automation session must still show (P2-8). It also needs the `trigger` expansion: the
    // sidebar's own policy never requests it, so a pinned automation row's name would otherwise
    // never resolve and fall back to "Missing schedule".
    sidebarPinned: {origin: "all", expansions: ["trigger"]},
    internal: {origin: "all", expansions: []},
    agentActivity: {origin: "all", expansions: []},
} as const satisfies Record<string, SessionListRequestPolicy>
