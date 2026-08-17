import {type SessionStream} from "@agenta/entities/session"
import {queryWorkflows, workflowMolecule} from "@agenta/entities/workflow"
import {isStartedSession, pinnedSessionIdsAtom} from "@agenta/sessions/state"
import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {sessionOpenTarget} from "@/oss/components/AgentChatSlice/assets/sessionOpenTarget"
import {sessionDotStatusAtomFamily} from "@/oss/components/AgentChatSlice/state/liveness"
import {
    activeSessionIdAtomFamily,
    defaultScopeKeyAtom,
    sessionsListAtomFamily,
    sessionStatusAtomFamily,
} from "@/oss/components/AgentChatSlice/state/sessions"
import {isValidUUID} from "@/oss/lib/helpers/validators"
import {sessionListPolicies} from "@/oss/lib/sessionListPolicies"
import {projectIdAtom} from "@/oss/state/project"

import {sidebarSessionOptions, SIDEBAR_SESSION_VISIBLE_LIMIT} from "./sessionOptions"
import type {SidebarEntityRef} from "./types"

/** A session row as the sidebar needs it: enough to label it, dot it, and open it. */
export interface SessionSidebarRef extends SidebarEntityRef {
    sessionId: string
    appId: string | null
    pinned: boolean
    alive: boolean
    /** A turn is in flight — the row spins. Resolved for rendered rows only (see below). */
    running: boolean
    /** Owning agent's display name, for the row's hover tooltip. Null until the artifact resolves. */
    agentName: string | null
}

/** Deliberately small — the sidebar shows the top of the list, and the sessions page owns
 * search, filters and paging. Gated by the group's open state like every other entity, so a
 * collapsed Sessions group costs nothing. Pins are fetched by id in their own query: a pinned
 * session older than this window must still appear. */
const sidebarSessionsQueryAtom = atomWithQuery<SessionStream[] | null>((get) => {
    const projectId = get(projectIdAtom)
    const pinnedIds = get(pinnedSessionIdsAtom)
    const options = sidebarSessionOptions({
        projectId: projectId ?? "",
        excludeSessionIds: pinnedIds,
    })
    return {
        queryKey: ["sidebar", ...options.queryKey],
        queryFn: ({signal}) =>
            options.queryFn({pageParam: null, signal}).then((page) => page?.sessions ?? null),
        enabled: Boolean(projectId),
        staleTime: 30_000,
        refetchOnWindowFocus: true,
    }
})

const sidebarPinnedSessionsQueryAtom = atomWithQuery<SessionStream[] | null>((get) => {
    const projectId = get(projectIdAtom)
    const pinnedIds = get(pinnedSessionIdsAtom)
    // A pin overrides the sidebar's origin filter — a pinned automation session must still show
    // (P2-8).
    const options = sidebarSessionOptions({
        projectId: projectId ?? "",
        sessionIds: pinnedIds,
        policy: sessionListPolicies.sidebarPinned,
    })
    return {
        queryKey: ["sidebar", "pinned", ...options.queryKey],
        queryFn: ({signal}) =>
            options.queryFn({pageParam: null, signal}).then((page) => page?.sessions ?? null),
        enabled: Boolean(projectId) && pinnedIds.length > 0,
        staleTime: 30_000,
        refetchOnWindowFocus: true,
    }
})

/**
 * Every session row the sidebar has fetched — the recent window plus the pins it excludes.
 *
 * For consumers that need per-agent activity rather than rendered rows (the Agents group's recency
 * ordering). Reading it from another group shares these query keys instead of adding a second
 * window request.
 */
export const sidebarSessionRowsAtom = atom<SessionStream[]>((get) => [
    ...(get(sidebarPinnedSessionsQueryAtom).data ?? []),
    ...(get(sidebarSessionsQueryAtom).data ?? []),
])

/** Null when the row has no open target yet (no turns) — the sidebar drops it rather than
 * rendering a link to `/apps/null`. */
const toSidebarRef = (row: SessionStream, pinned: Set<string>): SessionSidebarRef | null => {
    const target = sessionOpenTarget(row)
    if (!target) return null
    return {
        id: row.session_id,
        sessionId: row.session_id,
        // Raw, so the row menu's rename prefills the real name instead of the label's fallback.
        name: row.name?.trim() || null,
        appId: target.appId,
        pinned: pinned.has(row.session_id),
        alive: Boolean(row.flags?.is_alive),
        running: false,
        agentName: null,
    }
}

/**
 * Playground sessions the server-backed list cannot show yet, as sidebar rows.
 *
 * A session is created CLIENT-side (`addSessionAtomFamily` writes localStorage); the server first
 * hears about it when its first turn runs, and even then its row carries no `references` until that
 * turn lands — so `sessionOpenTarget` rejects it and the list below drops it. Until the first turn
 * completes, the local tab store is the ONLY place a session exists for the sidebar.
 *
 * Two sessions qualify, and both are demonstrably not abandoned:
 *  - the one you are looking at;
 *  - any that is RUNNING or awaiting your input. Keying this on "active" alone was the bug behind
 *    Mahmoud's repro: switching tabs mid-first-turn dropped the running session's row (and with it
 *    the spinner) until its turn finished and the server list could carry it.
 *
 * Scope is the routed app id, so rows disappear when you leave that playground — an abandoned blank
 * chat never lingers. Surfaces that override the chat scope through React context (the revision
 * drawer, onboarding) are not reflected; the sidebar cannot read context.
 */
const localPlaygroundSessionRefsAtom = atom<SessionSidebarRef[]>((get) => {
    const scope = get(defaultScopeKeyAtom)
    // The scope key doubles as the app id for the row's link, so it must be a real one.
    if (!isValidUUID(scope)) return []
    const sessions = get(sessionsListAtomFamily(scope))
    const rawActiveId = get(activeSessionIdAtomFamily(scope))
    // Same fallback the panel applies to a stale active id (its tab was closed).
    const active = sessions.find((session) => session.id === rawActiveId) ?? sessions[0] ?? null
    const pinned = get(pinnedSessionIdsAtom)
    // `error` is settled, not live — an errored empty session is as abandoned as an untouched one.
    const isLive = (id: string) => {
        const status = get(sessionStatusAtomFamily(id))
        return status === "running" || status === "awaiting"
    }
    return sessions
        .filter((session) => session.id === active?.id || isLive(session.id))
        .map((session) => ({
            id: session.id,
            sessionId: session.id,
            name: session.title?.trim() || null,
            appId: scope,
            pinned: pinned.includes(session.id),
            alive: false,
            running: false,
            agentName: null,
        }))
})

/**
 * Adds the local playground rows to the list, skipping any the server already returned — the server
 * row wins there, it carries the title, preview and liveness the local one cannot know.
 *
 * They land at the head of the unpinned rows: they are the most recently touched sessions by
 * definition, and pins keep the top the way they do everywhere else.
 */
export const withLocalSessions = (
    refs: readonly SessionSidebarRef[],
    locals: readonly SessionSidebarRef[],
): SessionSidebarRef[] => {
    const known = new Set(refs.map((ref) => ref.sessionId))
    const missing = locals.filter((local) => !known.has(local.sessionId))
    if (!missing.length) return [...refs]
    const firstUnpinned = refs.findIndex((ref) => !ref.pinned)
    const at = firstUnpinned === -1 ? refs.length : firstUnpinned
    return [...refs.slice(0, at), ...missing, ...refs.slice(at)]
}

/**
 * Ids of agents the user archived — ONE list request for the whole group, never a lookup per row.
 *
 * It has to be its own request: the app's workflows list sends `include_archived: false`, so an
 * archived agent is simply ABSENT there, and absence is not proof — a workflow missing from a
 * windowed list would read as archived and its live sessions would vanish. Asking WITH archived
 * included and keeping the `deleted_at` ones gives a positive answer instead. Archived-ness is the
 * same `deleted_at` signal the agents page splits its "Archived agents" tab on.
 *
 * Null until the answer arrives, so the filter below stays inert rather than hiding rows on a
 * pending query. Gated with the rest of the group: a collapsed Sessions group never asks.
 */
const archivedAgentIdsQueryAtom = atomWithQuery<ReadonlySet<string> | null>((get) => {
    const projectId = get(projectIdAtom)
    return {
        queryKey: ["sidebar", "workflows", "archived", projectId],
        queryFn: async () => {
            const response = await queryWorkflows({
                projectId: projectId ?? "",
                flags: {is_evaluator: false},
                includeArchived: true,
                lowPriority: true,
            })
            const archived = new Set<string>()
            for (const workflow of response.workflows ?? []) {
                if (workflow.deleted_at) archived.add(workflow.id)
            }
            return archived as ReadonlySet<string>
        },
        enabled: Boolean(projectId),
        staleTime: 60_000,
        refetchOnWindowFocus: false,
    }
})

/**
 * Drops sessions whose agent has been archived — an archived agent's conversations are not what the
 * sidebar's short list is for.
 *
 * Rows that survive regardless: a PINNED one (a pin is explicit, the same exemption every other
 * list rule gives it), one with no agent at all, and — while `archivedAgentIds` is null, i.e. the
 * answer hasn't arrived — every row. A row is dropped only on positive proof its agent is archived,
 * never on absent evidence.
 *
 * Runs BEFORE the visible cap so archived rows can't eat slots the backfill should have used.
 */
export const dropArchivedAgentSessions = (
    refs: readonly SessionSidebarRef[],
    archivedAgentIds: ReadonlySet<string> | null,
): SessionSidebarRef[] =>
    archivedAgentIds === null
        ? [...refs]
        : refs.filter((ref) => ref.pinned || !ref.appId || !archivedAgentIds.has(ref.appId))

/**
 * Pinned sessions first, then the rest by activity.
 *
 * Pins are pulled to the top rather than left in place because a pinned conversation is one you
 * return to over days — exactly what a recency-ordered list buries.
 */
const sidebarSessionRefsAtom = atom<SessionSidebarRef[]>((get) => {
    const pinned = new Set(get(pinnedSessionIdsAtom))
    // The owning agent's name for the row tooltip, read off the workflow ARTIFACT (a revision's
    // own `name` is the variant's, never the entity's). The group is gated, so a closed Sessions
    // group asks for nothing.
    const agentNameOf = (appId: string | null) =>
        appId ? get(workflowMolecule.selectors.artifactName(appId)) : null
    const pinnedRows = get(sidebarPinnedSessionsQueryAtom).data ?? []
    // The server excludes pins before paging; this remains a defensive dedupe. Chats that were
    // opened but never used are dropped here (the shared list rule) so the group's few slots hold
    // real sessions — the window above is sized to have real ones left after this.
    const recentRows = (get(sidebarSessionsQueryAtom).data ?? []).filter(
        (row) => !pinned.has(row.session_id) && isStartedSession(row),
    )

    const isRef = (ref: SessionSidebarRef | null): ref is SessionSidebarRef => ref !== null
    // Archived agents' sessions go before anything downstream counts rows: the name resolution
    // below and the group's visible cap both work off this list, so filtering here keeps archived
    // rows from eating slots the backfill should have given to live ones.
    const refs = withLocalSessions(
        dropArchivedAgentSessions(
            [
                ...pinnedRows.map((row) => toSidebarRef(row, pinned)).filter(isRef),
                ...recentRows.map((row) => toSidebarRef(row, pinned)).filter(isRef),
            ],
            get(archivedAgentIdsQueryAtom).data ?? null,
        ),
        get(localPlaygroundSessionRefsAtom),
    )
    // Names and run state are resolved for the RENDERED rows only. Each name subscribes to that
    // agent's artifact query, and the request window behind this list is several times what the
    // group ever shows — resolving all of it would fetch artifacts for rows nobody sees. The full
    // list still goes out so the "Show all" overflow count stays honest.
    return refs.map((ref, index) =>
        index < SIDEBAR_SESSION_VISIBLE_LIMIT
            ? {
                  ...ref,
                  agentName: agentNameOf(ref.appId),
                  running: get(sessionDotStatusAtomFamily(ref.sessionId)) === "running",
              }
            : ref,
    )
})

export const sidebarSessionsListAtom = atom((get) => {
    const query = get(sidebarSessionsQueryAtom)
    const pinnedQuery = get(sidebarPinnedSessionsQueryAtom)
    const hasPins = get(pinnedSessionIdsAtom).length > 0
    // A failed pin fetch must surface: the recent window excludes pinned ids, so silence here
    // would just make the pinned sessions vanish.
    const pinnedFailed = hasPins && pinnedQuery.isError
    return {
        data: get(sidebarSessionRefsAtom),
        isPending: query.isPending || (hasPins && pinnedQuery.isPending),
        isError: query.isError || pinnedFailed,
        error: query.error ?? (pinnedFailed ? pinnedQuery.error : null) ?? null,
    }
})
