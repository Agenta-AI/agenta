import {queryInteractions, querySessions, type SessionStream} from "@agenta/entities/session"
import {agentWorkflowsListQueryStateAtom, workflowMolecule} from "@agenta/entities/workflow"
import {sessionOpenTarget} from "@agenta/sessions/row"
import {pinnedSessionIdsAtom} from "@agenta/sessions/state"
import {idleReadyAtom, projectIdAtom} from "@agenta/shared/state"
import {keepPreviousData} from "@tanstack/react-query"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {SESSIONS_SIDEBAR_KEY} from "../constants"
import {sidebarOpenGroupsAtomFamily, sidebarPopupGroupsAtomFamily} from "../state"

import {
    sidebarSessionCollapsedGroupsAtomFamily,
    ACTIVITY_WINDOW_HOURS,
    sidebarSessionFiltersAtomFamily,
    type SidebarSessionGroupBy,
    sidebarSessionFiltersDirtyAtomFamily,
    type SidebarSessionFilters,
} from "./sessionFilters"
import type {SidebarEntityGroup, SidebarEntityRef} from "./types"

/** A session row as the sidebar needs it: enough to label it, dot it, and open it. */
export interface SessionSidebarRef extends SidebarEntityRef {
    sessionId: string
    /** Null until the session resolves an open target (a client-created row has none yet). */
    appId: string | null
    pinned: boolean
    alive: boolean
    /** The owning agent's workflow id — the grouping key, and what the agent facet filters on. */
    agentId: string | null
    agentName?: string | null
    /** A turn is in flight — the row spins. Resolved for rendered rows only. */
    running: boolean
    /** A human gate is open on this session. Resolved for grouped scopes only. */
    waiting?: boolean
    /** Deliberately hidden. The row fades and its menu drops the verbs that make no sense. */
    archived: boolean
    /** Last activity, for the date buckets. */
    activityAt?: string | null
    /** Which heading this row sits under, resolved against the active `groupBy`. */
    groupKey?: string
    /** That heading's text. Carried here so the headings atom needs no second derivation. */
    groupLabel?: string
}

/** Deliberately small — the sidebar shows the top of the list, and the sessions page owns
 * search, filters and paging. Gated by the group's open state like every other entity, so a
 * collapsed Sessions group costs nothing. Pins are fetched by id in their own query: a pinned
 * session older than this window must still appear. */
const SIDEBAR_SESSION_LIMIT = 20

/** Scopes that group and filter fetch a wider window: a heading over one row says nothing, and
 * a filter needs more than the top of the list to narrow. Others keep the original window. */
const SCOPE_SESSION_LIMIT: Record<string, number> = {"mobile-main": 50}

const scopeLimit = (scopeId: string) => SCOPE_SESSION_LIMIT[scopeId] ?? SIDEBAR_SESSION_LIMIT

/** The fetched window, for a rail that renders all of it — so the two numbers cannot drift and
 * leave rows silently dropped between the request and the render. */
export const sidebarSessionScopeLimit = scopeLimit

/** Scopes whose rail groups and filters. Everything below is gated on this so a scope that does
 * neither issues exactly the request, and takes exactly the subscriptions, it always did. */
const GROUPED_SCOPES = new Set(["mobile-main"])
const scopeGroups = (scopeId: string) => GROUPED_SCOPES.has(scopeId)

/** Every filter is a server predicate: narrowing a fetched page would filter the window, not
 * the set. Liveness maps onto the row's mirrored flags; the agent onto the turns' references. */
const requestFilters = (filters: SidebarSessionFilters) => {
    const flags: {is_running?: boolean; is_alive?: boolean} = {}
    if (filters.status === "running") flags.is_running = true
    if (filters.status === "idle") flags.is_alive = false
    // A date floor, not a cursor: the DAO reads `windowing.oldest` as
    // `coalesce(updated_at, created_at) >= oldest`, so this is a real server predicate.
    const hours = ACTIVITY_WINDOW_HOURS[filters.activity]
    return {
        // NOT one `references` list: the DAO matches it with JSONB containment, so two ids ask
        // for sessions belonging to BOTH agents. Selecting several means one request each.
        agentIds: filters.agentIds,
        flags: Object.keys(flags).length ? flags : undefined,
        archivedOnly: filters.archivedOnly,
        // `querySessions` defaults this to true; the rail must hide archived rows unless the
        // archived view is on, and `archived_only` is what narrows to them.
        includeArchived: filters.archivedOnly,
        oldest: hours ? new Date(Date.now() - hours * 3_600_000).toISOString() : undefined,
    }
}

/**
 * Poll only while something can still change: a row's dot is driven by `is_alive`, which the
 * server flips when the stream ends — with no request, the dot stays filled until you reload.
 * Stops once every row is idle, so a quiet rail costs nothing.
 */
const livePollInterval = (rows: SessionStream[] | null | undefined) =>
    (rows ?? []).some((row) => row.flags?.is_alive || row.flags?.is_running) ? 15_000 : false

/**
 * One request per selected agent, merged — see `requestFilters` on why they cannot be one.
 *
 * Unioned by session id and re-sorted by last activity, which is the order the server would have
 * returned had it been able to answer in one query. Each request carries the full window, so the
 * merge widens coverage rather than splitting it.
 */
const queryByAgents = async (
    agentIds: readonly string[],
    run: (references: {id: string}[] | undefined) => Promise<SessionStream[] | null>,
): Promise<SessionStream[] | null> => {
    if (agentIds.length === 0) return run(undefined)
    const pages = await Promise.all(agentIds.map((id) => run([{id}])))
    const byId = new Map<string, SessionStream>()
    for (const page of pages) for (const row of page ?? []) byId.set(row.session_id, row)
    const activity = (row: SessionStream) =>
        new Date(row.updated_at ?? row.created_at ?? 0).getTime()
    return [...byId.values()].sort((a, b) => activity(b) - activity(a))
}

/**
 * Sessions with a human interaction waiting on you.
 *
 * Two jobs: the id set the "Awaiting input" status pushes down to the server (there is no
 * predicate for it), and the amber dot a grouped rail paints on a blocked row. A grouped scope
 * therefore subscribes always; every other scope only while that status is picked, so a rail that
 * cannot show the dot still costs exactly one request.
 */
const sidebarWaitingIdsQueryAtomFamily = atomFamily((scopeId: string) =>
    atomWithQuery<string[] | null>((get) => {
        const projectId = get(projectIdAtom)
        const status = get(sidebarSessionFiltersAtomFamily(scopeId)).status
        // "Idle" needs the set too — to SUBTRACT it. A gated session is waiting, not idle.
        const needed = status === "waiting" || status === "idle"
        return {
            queryKey: ["sidebar-sessions-waiting", projectId],
            queryFn: async ({signal}) => {
                const rows = await queryInteractions({
                    projectId: projectId ?? "",
                    actionableOnly: true,
                    abortSignal: signal,
                })
                return [...new Set((rows ?? []).map((row) => row.session_id))]
            },
            enabled: Boolean(projectId) && (needed || scopeGroups(scopeId)),
            staleTime: 10_000,
            // A gate opens while you are looking elsewhere in the app, so focus alone is not
            // enough for the dot; faster while one is already open, since that is when more land.
            refetchInterval: (query) => ((query.state.data?.length ?? 0) > 0 ? 15_000 : 30_000),
            refetchOnWindowFocus: true,
        }
    }),
)

const sidebarSessionsQueryAtomFamily = atomFamily((scopeId: string) =>
    atomWithQuery<SessionStream[] | null>((get) => {
        const projectId = get(projectIdAtom)
        const filters = get(sidebarSessionFiltersAtomFamily(scopeId))
        const {agentIds, flags, archivedOnly, includeArchived, oldest} = requestFilters(filters)
        const waiting = filters.status === "waiting"
        const waitingQuery = get(sidebarWaitingIdsQueryAtomFamily(scopeId))
        const waitingIds = waitingQuery.data ?? null
        return {
            queryKey: [
                "sidebar-sessions",
                projectId,
                filters.agentIds,
                filters.status,
                filters.activity,
                filters.archivedOnly,
                waiting ? waitingIds : null,
            ],
            queryFn: ({signal}) =>
                queryByAgents(agentIds, (references) =>
                    querySessions({
                        projectId: projectId ?? "",
                        references,
                        flags,
                        archivedOnly,
                        includeArchived,
                        oldest,
                        // No server predicate for "awaiting input" — ids are pushed down instead.
                        sessionIds: waiting ? (waitingIds ?? []) : undefined,
                        limit: scopeLimit(scopeId),
                        abortSignal: signal,
                        lowPriority: true,
                    }),
                ),
            // Pinned-only keeps this query MOUNTED but disabled. Unmounting it would flip the source
            // to `loading`, and the idle-fallback cache only rescues `idle` — the list would blank.
            // "Awaiting input" additionally waits for the id set, or it would ask for everything.
            enabled: Boolean(projectId) && !filters.pinnedOnly && (!waiting || waitingIds !== null),
            // Without this every facet click is a cache miss that empties the group
            // mid-interaction. Only where filters exist: elsewhere the key changes on a PROJECT
            // switch, where holding the previous project's rows would be wrong.
            placeholderData: scopeGroups(scopeId) ? keepPreviousData : undefined,
            staleTime: 30_000,
            refetchInterval: (query) => livePollInterval(query.state.data),
            refetchOnWindowFocus: true,
        }
    }),
)

const sidebarPinnedSessionsQueryAtomFamily = atomFamily((scopeId: string) =>
    atomWithQuery<SessionStream[] | null>((get) => {
        const projectId = get(projectIdAtom)
        const allPinnedIds = get(pinnedSessionIdsAtom)
        const filters = get(sidebarSessionFiltersAtomFamily(scopeId))
        const {agentIds, flags, archivedOnly, includeArchived} = requestFilters(filters)
        const waiting = filters.status === "waiting"
        const waitingIds = get(sidebarWaitingIdsQueryAtomFamily(scopeId)).data ?? null
        // "Awaiting input" has no server predicate — it is an id set — so a pin has to be
        // intersected with it here. Passing the pins through unfiltered is what put an idle
        // pinned row under the Awaiting filter.
        const pinnedIds =
            waiting && waitingIds
                ? allPinnedIds.filter((id) => waitingIds.includes(id))
                : allPinnedIds
        return {
            queryKey: [
                "sidebar-sessions-pinned",
                projectId,
                pinnedIds,
                filters.agentIds,
                filters.status,
                filters.archivedOnly,
            ],
            // A pin is not exempt from the filters: filtering to one agent must not leave another
            // agent's pinned rows on top of the result.
            queryFn: ({signal}) =>
                queryByAgents(agentIds, (references) =>
                    querySessions({
                        projectId: projectId ?? "",
                        references,
                        flags,
                        archivedOnly,
                        includeArchived,
                        sessionIds: pinnedIds,
                        abortSignal: signal,
                        lowPriority: true,
                    }),
                ),
            enabled:
                Boolean(projectId) && pinnedIds.length > 0 && (!waiting || waitingIds !== null),
            placeholderData: scopeGroups(scopeId) ? keepPreviousData : undefined,
            staleTime: 30_000,
            refetchInterval: (query) => livePollInterval(query.state.data),
            refetchOnWindowFocus: true,
        }
    }),
)

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
        agentId: target.appId,
        pinned: pinned.has(row.session_id),
        alive: Boolean(row.flags?.is_alive),
        archived: Boolean(row.archived_at),
        running: false,
        activityAt: row.updated_at ?? row.created_at ?? null,
    }
}

/**
 * Sessions the server-backed queries cannot show yet, contributed by the HOST.
 *
 * A session is created CLIENT-side; the server first hears about it when its first turn runs, and
 * even then the row carries no `references` until that turn lands — so `sessionOpenTarget` rejects
 * it and the queries above drop it. Until then the host's local store is the only place it exists.
 *
 * The host owns this because the local store is app state (chat tabs) that a package must not
 * reach into; `@agenta/navigation` only composes what it is given. Keying on "active" alone was
 * the bug behind Mahmoud's repro: switching tabs mid-first-turn dropped the RUNNING session's row
 * (and its spinner) until the turn finished and the server list could carry it.
 */
export const localSessionRefsAtom = atom<SessionSidebarRef[]>([])

/**
 * Drop sessions whose agent has been archived (#5944) — an archived agent's conversations should
 * not keep occupying the rail. A PIN is an explicit user request and is exempt, the same exemption
 * it gets from every other list rule.
 */
export const dropArchivedAgentSessions = (
    refs: readonly SessionSidebarRef[],
    // `null` = the archived-agents answer has not arrived; keep everything rather than blink rows
    // out and back in once it does.
    archivedAgentIds: ReadonlySet<string> | null,
): SessionSidebarRef[] =>
    archivedAgentIds === null
        ? [...refs]
        : refs.filter((ref) => ref.pinned || !ref.appId || !archivedAgentIds.has(ref.appId))

/**
 * Host-local rows lead the RECENT rows but never displace pins: pins are pulled to the top because
 * they are conversations you return to over days, and a session you happen to have open must not
 * push them down. A server row for the same session wins once it exists — it carries the resolved
 * open target and the liveness flags.
 */
export const withLocalSessions = (
    server: readonly SessionSidebarRef[],
    local: readonly SessionSidebarRef[],
): SessionSidebarRef[] => {
    const known = new Set(server.map((ref) => ref.sessionId))
    const fresh = local.filter((ref) => !known.has(ref.sessionId))
    const pinned = server.filter((ref) => ref.pinned)
    const rest = server.filter((ref) => !ref.pinned)
    return [...pinned, ...fresh, ...rest]
}

/**
 * Pinned sessions first, then the rest by activity.
 *
 * Pins are pulled to the top rather than left in place because a pinned conversation is one you
 * return to over days — exactly what a recency-ordered list buries. The ordering is the only
 * signal: the list renders rows, not headings.
 */
const sidebarSessionRefsAtomFamily = atomFamily((scopeId: string) =>
    atom<SessionSidebarRef[]>((get) => {
        const filters = get(sidebarSessionFiltersAtomFamily(scopeId))
        const pinnedOnly = filters.pinnedOnly
        const pinned = new Set(get(pinnedSessionIdsAtom))
        const waitingIds = new Set(get(sidebarWaitingIdsQueryAtomFamily(scopeId)).data ?? [])
        const pinnedRows = get(sidebarPinnedSessionsQueryAtomFamily(scopeId)).data ?? []
        // Pins come from their own by-id query; the recent window drops them so nothing shows twice.
        const recentRows = pinnedOnly
            ? []
            : (get(sidebarSessionsQueryAtomFamily(scopeId)).data ?? []).filter(
                  (row) => !pinned.has(row.session_id),
              )

        const isRef = (ref: SessionSidebarRef | null): ref is SessionSidebarRef => ref !== null
        const server = [
            ...pinnedRows.map((row) => toSidebarRef(row, pinned)).filter(isRef),
            ...recentRows.map((row) => toSidebarRef(row, pinned)).filter(isRef),
        ]
        const all = withLocalSessions(server, pinnedOnly ? [] : get(localSessionRefsAtom))
        // "Idle" is `is_alive: false` on the server, which also matches a session whose turn ended
        // with a gate still open. That session is WAITING — the shared status rule ranks a gate
        // above liveness — so it is subtracted here. The only client-side narrowing in this file,
        // and a deliberate one: no server predicate can express "no open gate".
        const merged =
            filters.status === "idle" ? all.filter((ref) => !waitingIds.has(ref.sessionId)) : all

        // An ungrouped scope needs neither, and the artifactName read would subscribe it to the
        // workflow catalog it never asked for.
        if (!scopeGroups(scopeId)) return merged

        const groupBy = filters.groupBy
        const now = Date.now()
        // The owning agent's name, read off the workflow ARTIFACT — the same selector every other
        // session surface uses, so a heading and a row can never disagree about an agent's name.
        // The heading is resolved HERE, not in the entity's `getGroupKey`: that closure is not
        // reactive, so a `groupBy` change would not re-bucket the rows.
        return merged.map((ref) => {
            const named = {
                ...ref,
                waiting: waitingIds.has(ref.sessionId),
                agentName: ref.agentId
                    ? (get(workflowMolecule.selectors.artifactName(ref.agentId)) ?? null)
                    : null,
            }
            const group = sidebarSessionGroup(named, groupBy, now)
            return {...named, groupKey: group.key, groupLabel: group.label}
        })
    }),
)

const PINNED_GROUP_KEY = "pinned"
const UNASSIGNED_GROUP_KEY = "agent:none"

const DAY = 24 * 60 * 60 * 1000

const dateBucket = (activityAt: string | null | undefined, now: number) => {
    if (!activityAt) return {key: "date:older", label: "Older"}
    const age = now - new Date(activityAt).getTime()
    if (age < DAY) return {key: "date:today", label: "Today"}
    if (age < 2 * DAY) return {key: "date:yesterday", label: "Yesterday"}
    if (age < 7 * DAY) return {key: "date:week", label: "Previous 7 days"}
    return {key: "date:older", label: "Older"}
}

/**
 * Which heading a row sits under.
 *
 * Pins always lead in their own heading, whichever grouping is active — a pinned conversation is
 * one you return to over days, exactly what any other ordering buries.
 */
export const sidebarSessionGroup = (
    ref: SessionSidebarRef,
    groupBy: SidebarSessionGroupBy,
    now: number,
): {key: string; label: string} => {
    if (ref.pinned) return {key: PINNED_GROUP_KEY, label: "Pinned"}
    if (groupBy === "pinned") return {key: "recent", label: "Recent"}
    if (groupBy === "date") return dateBucket(ref.activityAt, now)
    if (groupBy === "status") {
        if (ref.running) return {key: "status:running", label: "Running"}
        return ref.alive ? {key: "status:live", label: "Live"} : {key: "status:idle", label: "Idle"}
    }
    if (!ref.agentId) return {key: UNASSIGNED_GROUP_KEY, label: "No agent yet"}
    // `||`, not `??`: an artifact whose name resolves to "" must still get a heading you can read.
    return {key: `agent:${ref.agentId}`, label: ref.agentName?.trim() || "Agent"}
}

/** The entity reads the bucket off the row — resolved upstream, so a `groupBy` change flows. */
export const sidebarSessionGroupKey = (ref: SessionSidebarRef): string =>
    ref.groupKey ?? PINNED_GROUP_KEY

/**
 * The group headings the Sessions rows sit under: Pinned first, then each agent in order of its
 * most recent session. Ordering only — `resolveChildren` owns the row cap, so a group whose rows
 * all fall outside it is dropped there rather than here.
 */
export const sidebarSessionGroupsAtomFamily = atomFamily((scopeId: string) =>
    atom((get) => {
        const refs = get(sidebarSessionRefsAtomFamily(scopeId))
        const labels = new Map<string, string>()
        for (const ref of refs) {
            const key = sidebarSessionGroupKey(ref)
            if (!labels.has(key)) labels.set(key, ref.groupLabel ?? "Other")
        }
        const groups: SidebarEntityGroup[] = [...labels].map(([key, label]) => ({
            key,
            label,
            // Only the agent buckets name something openable — a date or a status heading has
            // nowhere to go. `agent:none` is a placeholder, not an agent.
            path:
                key.startsWith("agent:") && key !== UNASSIGNED_GROUP_KEY
                    ? `/agents/${key.slice("agent:".length)}`
                    : undefined,
        }))
        const dirty = get(sidebarSessionFiltersDirtyAtomFamily(scopeId))
        return {
            groups,
            collapsedKeys: get(sidebarSessionCollapsedGroupsAtomFamily(scopeId)),
            // Say WHY the group is empty: with a filter on, "No sessions" reads as "you have none".
            emptyLabel: dirty ? "No sessions match these filters" : undefined,
        }
    }),
)

export const sidebarSessionsListAtomFamily = atomFamily((scopeId: string) =>
    atom((get) => {
        const query = get(sidebarSessionsQueryAtomFamily(scopeId))
        const pinnedQuery = get(sidebarPinnedSessionsQueryAtomFamily(scopeId))
        const hasPins = get(pinnedSessionIdsAtom).length > 0
        // A failed pin fetch must surface: the recent window excludes pinned ids, so silence here
        // would just make the pinned sessions vanish.
        const pinnedFailed = hasPins && pinnedQuery.isError
        return {
            data: get(sidebarSessionRefsAtomFamily(scopeId)),
            isPending: query.isPending || (hasPins && pinnedQuery.isPending),
            isError: query.isError || pinnedFailed,
            error: query.error ?? (pinnedFailed ? pinnedQuery.error : null) ?? null,
        }
    }),
)

/**
 * Agents the filter can narrow to, from the same catalog the Agents group lists.
 *
 * Gated on the Sessions group being open, exactly like the session query itself: the filter is
 * only reachable from an open group, and an ungated read would pull the agent catalog on every
 * sidebar mount. Derived from the catalog rather than from the loaded sessions on purpose —
 * options taken from the current rows would collapse to one entry as soon as a filter applied.
 */
export const sidebarSessionAgentOptionsAtomFamily = atomFamily((scopeId: string) =>
    atom<{value: string; label: string}[]>((get) => {
        const inlineOpen = (get(sidebarOpenGroupsAtomFamily(scopeId)) ?? []).includes(
            SESSIONS_SIDEBAR_KEY,
        )
        const popupOpen = get(sidebarPopupGroupsAtomFamily(scopeId)).includes(SESSIONS_SIDEBAR_KEY)
        if ((!inlineOpen && !popupOpen) || !get(idleReadyAtom)) return []

        const agents = get(agentWorkflowsListQueryStateAtom)
        return agents.data.map((agent) => ({
            value: agent.id,
            label: agent.name || agent.slug || "Untitled agent",
        }))
    }),
)
