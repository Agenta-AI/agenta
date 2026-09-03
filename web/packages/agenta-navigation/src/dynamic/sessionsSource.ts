import {queryInteractions, querySessions, type SessionStream} from "@agenta/entities/session"
import {
    agentWorkflowsListQueryStateAtom,
    appWorkflowsListQueryAtom,
    workflowMolecule,
} from "@agenta/entities/workflow"
import {isAutomationSession, sessionOpenTarget} from "@agenta/sessions/row"
import {pinnedSessionIdsAtom} from "@agenta/sessions/state"
import {idleReadyAtom, projectIdAtom} from "@agenta/shared/state"
import {atom, type Getter} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {MAIN_SIDEBAR_SCOPE_ID, SESSIONS_SIDEBAR_KEY} from "../constants"
import {
    applyManualOrder,
    SIDEBAR_AGENT_ORDER_ZONE,
    SIDEBAR_STATUS_GROUP_ZONE,
    sidebarManualOrderAtomFamily,
    sidebarManualOrdersAtom,
    sidebarSessionZone,
    withManualAgentRanks,
} from "../reorder"
import {
    sidebarAlwaysOpenGroupsAtomFamily,
    sidebarOpenGroupsAtomFamily,
    sidebarPopupGroupsAtomFamily,
} from "../state"

import {
    PINNED_GROUP_KEY,
    sidebarSessionToggledGroupsAtomFamily,
    ACTIVITY_WINDOW_HOURS,
    sidebarSessionFiltersAtomFamily,
    type SidebarSessionGroupBy,
    sidebarSessionFiltersDirtyAtomFamily,
    type SidebarSessionFilters,
} from "./sessionFilters"
import type {SidebarEntityGroup, SidebarEntityRef, SidebarEntityReorder} from "./types"

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
    /** A trigger-originated run, not a human chat — the row carries the automation glyph. */
    isAutomation: boolean
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
    /** Where that heading sorts, ascending. Resolved with the bucket — see `sidebarSessionGroup`. */
    groupRank?: number
}

/** Deliberately small — the sidebar shows the top of the list, and the sessions page owns
 * search, filters and paging. Gated by the group's open state like every other entity, so a
 * collapsed Sessions group costs nothing. Pins are fetched by id in their own query: a pinned
 * session older than this window must still appear. */
const SIDEBAR_SESSION_LIMIT = 20

/** Scopes that group and filter fetch a wider window: a heading over one row says nothing, and
 * a filter needs more than the top of the list to narrow. Others keep the original window. */
const SCOPE_SESSION_LIMIT: Record<string, number> = {
    "mobile-main": 50,
    [MAIN_SIDEBAR_SCOPE_ID]: 50,
}

const scopeLimit = (scopeId: string) => SCOPE_SESSION_LIMIT[scopeId] ?? SIDEBAR_SESSION_LIMIT

/** The fetched window, for a rail that renders all of it — so the two numbers cannot drift and
 * leave rows silently dropped between the request and the render. */
export const sidebarSessionScopeLimit = scopeLimit

/** Scopes whose rail groups and filters. Everything below is gated on this so a scope that does
 * neither issues exactly the request, and takes exactly the subscriptions, it always did. */
const GROUPED_SCOPES = new Set(["mobile-main", MAIN_SIDEBAR_SCOPE_ID])
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
        // The rail never lists archived sessions; the sessions page owns the archive.
        includeArchived: false,
        // Chat and automation SWAP the list; `all` mixes them. Every direction is the server's
        // own `origin` predicate, so none of them narrows a page after fetching it.
        origin: filters.type === "automation" ? ("trigger" as const) : undefined,
        excludeOrigin: filters.type === "chat" ? ("trigger" as const) : undefined,
        oldest: hours ? new Date(Date.now() - hours * 3_600_000).toISOString() : undefined,
    }
}

/** Fast enough that a dot clears about when the stream does. */
const LIVE_POLL_MS = 15_000

/** Slow enough to be background noise, quick enough to notice a run you did not start. */
const IDLE_POLL_MS = 60_000

/**
 * Poll fast while something can still change, slowly the rest of the time.
 *
 * A row's dot is driven by `is_alive`/`is_running`, which the server flips when the stream ends —
 * with no request, the dot stays filled until you reload. The BASELINE matters just as much: a
 * turn started under another agent (a trigger, another browser) is invisible to this client, so a
 * rail that stopped polling when it looked quiet could never discover it, and only the session you
 * were driving yourself ever appeared to run.
 *
 * Both intervals are gated: the source only subscribes while the Sessions group is open and the
 * rail is expanded, and React Query holds the timer while the window is unfocused.
 */
export const livePollInterval = (rows: SessionStream[] | null | undefined) =>
    (rows ?? []).some((row) => row.flags?.is_alive || row.flags?.is_running)
        ? LIVE_POLL_MS
        : IDLE_POLL_MS

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
 * Carry the previous rows through a key change, but only inside the same project.
 *
 * A facet click and a project switch both change the key. The first wants the old rows held so the
 * group does not blink empty mid-interaction; the second must not, because those rows belong to a
 * project you just left.
 */
const keepPreviousDataWithinProject = (scopeId: string, projectId: string | null) =>
    scopeGroups(scopeId)
        ? (
              previous: SessionStream[] | null | undefined,
              previousQuery?: {queryKey: readonly unknown[]},
          ) => (previousQuery?.queryKey[1] === projectId ? previous : undefined)
        : undefined

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
        const {agentIds, flags, includeArchived, origin, excludeOrigin, oldest} =
            requestFilters(filters)
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
                filters.type,
                waiting ? waitingIds : null,
            ],
            queryFn: ({signal}) =>
                queryByAgents(agentIds, (references) =>
                    querySessions({
                        projectId: projectId ?? "",
                        references,
                        flags,
                        includeArchived,
                        origin,
                        excludeOrigin,
                        oldest,
                        // No server predicate for "awaiting input" — ids are pushed down instead.
                        sessionIds: waiting ? (waitingIds ?? []) : undefined,
                        limit: scopeLimit(scopeId),
                        abortSignal: signal,
                        lowPriority: true,
                    }),
                ),
            // "Awaiting input" waits for the id set, or it would ask for everything.
            enabled: Boolean(projectId) && (!waiting || waitingIds !== null),
            // Without this every facet click is a cache miss that empties the group
            // mid-interaction. Held ONLY within a project: the key carries the project id too, so
            // an unconditional carry-over shows the previous project's sessions in a new one.
            placeholderData: keepPreviousDataWithinProject(scopeId, projectId),
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
        const {agentIds, flags, includeArchived, origin, excludeOrigin} = requestFilters(filters)
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
                filters.type,
            ],
            // A pin is not exempt from the filters: filtering to one agent must not leave another
            // agent's pinned rows on top of the result.
            queryFn: ({signal}) =>
                queryByAgents(agentIds, (references) =>
                    querySessions({
                        projectId: projectId ?? "",
                        references,
                        flags,
                        includeArchived,
                        origin,
                        excludeOrigin,
                        sessionIds: pinnedIds,
                        abortSignal: signal,
                        lowPriority: true,
                    }),
                ),
            enabled:
                Boolean(projectId) && pinnedIds.length > 0 && (!waiting || waitingIds !== null),
            placeholderData: keepPreviousDataWithinProject(scopeId, projectId),
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
        running: Boolean(row.flags?.is_running),
        isAutomation: isAutomationSession(row),
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
 * Every agent the catalog still lists, or `null` while it loads. It excludes archived agents, so
 * "absent here" IS "archived". Requires an UNPAGED catalog: a limit on `appWorkflowsListQueryAtom`
 * would make every agent past the cap read as archived and lose its sessions.
 */
const liveAgentIdsAtom = atom<ReadonlySet<string> | null>((get) => {
    const query = get(appWorkflowsListQueryAtom)
    if (!query.data) return null
    return new Set((query.data.refs ?? []).map((ref: {id: string}) => ref.id))
})

/**
 * Drop sessions whose agent is no longer listed (#5944, #6457). A PIN is exempt, the same exemption
 * it gets from every other list rule.
 */
export const dropMissingAgentSessions = (
    refs: readonly SessionSidebarRef[],
    // `null` = catalog unanswered; an empty set would read as "all gone" and blank the rail.
    liveAgentIds: ReadonlySet<string> | null,
): SessionSidebarRef[] =>
    liveAgentIds === null
        ? [...refs]
        : refs.filter((ref) => ref.pinned || !ref.appId || liveAgentIds.has(ref.appId))

/**
 * The rail's filters, applied to the rows the HOST contributes.
 *
 * Every filter is a server predicate, and a local row never went through the query — so without
 * this a chat stayed listed, and selected, under Automation or under another agent's filter. The
 * activity window is the one exemption: a session you have open is current by definition.
 */
export const localSessionRefsMatching = (
    local: readonly SessionSidebarRef[],
    filters: SidebarSessionFilters,
    waitingIds: ReadonlySet<string>,
): SessionSidebarRef[] =>
    local.filter((ref) => {
        // A client-created chat is never a trigger run.
        if (filters.type === "automation") return false
        if (filters.agentIds.length > 0) {
            if (!ref.agentId || !filters.agentIds.includes(ref.agentId)) return false
        }
        const waiting = waitingIds.has(ref.sessionId) || Boolean(ref.waiting)
        if (filters.status === "running") return ref.running
        if (filters.status === "waiting") return waiting
        if (filters.status === "idle") return !ref.running && !waiting && !ref.alive
        return true
    })

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
    const hosted = new Map(local.map((ref) => [ref.sessionId, ref]))
    // The server row wins on identity and LOSES on liveness: `is_running` is mirrored onto a row
    // this rail polls, so a turn running in this very browser read as idle until the poll caught
    // up — which is why only one session ever appeared to be running.
    const live = server.map((ref) => {
        const host = hosted.get(ref.sessionId)
        if (!host) return ref
        return {
            ...ref,
            running: ref.running || host.running,
            waiting: ref.waiting || host.waiting,
        }
    })
    const pinned = live.filter((ref) => ref.pinned)
    const rest = live.filter((ref) => !ref.pinned)
    // Deduped: a row key is its session id, so a session reaching this twice renders two rows that
    // BOTH match the selected key — the rail's white pill landing on rows nobody selected.
    return uniqueBySession([...pinned, ...fresh, ...rest])
}

/** First occurrence wins — the merge above already put every row in the order it should hold. */
const uniqueBySession = (refs: readonly SessionSidebarRef[]): SessionSidebarRef[] => {
    const seen = new Set<string>()
    const unique: SessionSidebarRef[] = []
    for (const ref of refs) {
        if (seen.has(ref.sessionId)) continue
        seen.add(ref.sessionId)
        unique.push(ref)
    }
    return unique
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
        const pinned = new Set(get(pinnedSessionIdsAtom))
        const waitingIds = new Set(get(sidebarWaitingIdsQueryAtomFamily(scopeId)).data ?? [])
        // Filtered by the CURRENT pin set, not taken as the query left it: unpinning mints a new
        // query key, and the placeholder hands back the previous rows (forever, once the last pin
        // goes and the query disables) — rows the recent window now returns too.
        const pinnedRows = (get(sidebarPinnedSessionsQueryAtomFamily(scopeId)).data ?? []).filter(
            (row) => pinned.has(row.session_id),
        )
        // Pins come from their own by-id query; the recent window drops them so nothing shows twice.
        const recentRows = (get(sidebarSessionsQueryAtomFamily(scopeId)).data ?? []).filter(
            (row) => !pinned.has(row.session_id),
        )

        const isRef = (ref: SessionSidebarRef | null): ref is SessionSidebarRef => ref !== null
        const server = [
            ...pinnedRows.map((row) => toSidebarRef(row, pinned)).filter(isRef),
            ...recentRows.map((row) => toSidebarRef(row, pinned)).filter(isRef),
        ]
        const all = withLocalSessions(
            server,
            localSessionRefsMatching(get(localSessionRefsAtom), filters, waitingIds),
        )
        // "Idle" is `is_alive: false` on the server, which also matches a session whose turn ended
        // with a gate still open. That session is WAITING — the shared status rule ranks a gate
        // above liveness — so it is subtracted here. The only client-side narrowing in this file,
        // and a deliberate one: no server predicate can express "no open gate".
        const narrowed =
            filters.status === "idle" ? all.filter((ref) => !waitingIds.has(ref.sessionId)) : all
        // Archiving an agent has to take its conversations off the rail with it (#5944). Applied
        // to every scope, grouped or not: an archived agent's sessions are stale everywhere the
        // rail renders, not only where headings group them by agent.
        const merged = dropMissingAgentSessions(narrowed, get(liveAgentIdsAtom))

        // An ungrouped scope needs neither, and the artifactName read would subscribe it to the
        // workflow catalog it never asked for.
        if (!scopeGroups(scopeId)) return merged

        const groupBy = filters.groupBy
        const now = Date.now()
        // The owning agent's name, read off the workflow ARTIFACT — the same selector every other
        // session surface uses, so a heading and a row can never disagree about an agent's name.
        // The heading is resolved HERE, not in the entity's `getGroupKey`: that closure is not
        // reactive, so a `groupBy` change would not re-bucket the rows.
        const grouped = merged.map((ref) => {
            const named = {
                ...ref,
                // OR, not a replacement: a gate the host already knows about is open before the
                // interactions query has a row for it.
                waiting: waitingIds.has(ref.sessionId) || Boolean(ref.waiting),
                agentName: ref.agentId
                    ? (get(workflowMolecule.selectors.artifactName(ref.agentId)) ?? null)
                    : null,
            }
            const group = sidebarSessionGroup(named, groupBy, now)
            return {
                ...named,
                groupKey: group.key,
                groupLabel: group.label,
                groupRank: group.rank,
            }
        })

        const orderFor = get(sidebarManualOrdersAtom)
        return applyManualSessionOrder(grouped, orderFor)
    }),
)

/**
 * Applies each heading's hand-arranged row order, heading by heading.
 *
 * Buckets keep their first-seen order — `groupedChildren` re-buckets anyway, and holding it steady
 * avoids gratuitous identity churn. A bucket with no saved zone (Pinned, Recent, any date heading)
 * passes through untouched, which is how "pins lead" survives.
 */
const applyManualSessionOrder = (
    rows: SessionSidebarRef[],
    orderFor: (zone: string) => string[],
): SessionSidebarRef[] => {
    const buckets = new Map<string, SessionSidebarRef[]>()
    for (const row of rows) {
        const key = row.groupKey ?? PINNED_GROUP_KEY
        const bucket = buckets.get(key)
        if (bucket) bucket.push(row)
        else buckets.set(key, [row])
    }
    let changed = false
    const out: SessionSidebarRef[] = []
    for (const [key, bucket] of buckets) {
        const order = orderFor(sidebarSessionZone(key))
        // A session the arrangement has not seen leads: you just started it.
        const sorted = order.length
            ? applyManualOrder(bucket, (row) => row.sessionId, order, "lead")
            : bucket
        if (sorted.some((row, index) => row !== bucket[index])) changed = true
        out.push(...sorted)
    }
    return changed ? out : rows
}

const UNASSIGNED_GROUP_KEY = "agent:none"

/** Below every other rank: pins lead under every grouping. Finite, so ranks subtract cleanly. */
const PINNED_GROUP_RANK = Number.MIN_SAFE_INTEGER

/** Above every other rank, for a bucket with no date to sort on. */
const UNDATED_GROUP_RANK = Number.MAX_SAFE_INTEGER

/** A heading, plus where it sorts — ascending, ties broken by label. */
interface SessionGroupBucket {
    key: string
    label: string
    rank: number
}

const DAY = 24 * 60 * 60 * 1000

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** Local midnight — the buckets are CALENDAR days, so 11pm last night is Yesterday, not Today. */
const startOfDay = (time: number) => {
    const date = new Date(time)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
}

/**
 * One heading per DAY, named by its date.
 *
 * "Previous 7 days" told you a session was somewhere in a week — the one thing a date heading is
 * supposed to settle. Only today and yesterday keep words, because those are the two dates people
 * read faster as names. The year is added once it is not the current one.
 */
const dateBucket = (activityAt: string | null | undefined, now: number): SessionGroupBucket => {
    if (!activityAt) return {key: "date:unknown", label: "No activity", rank: UNDATED_GROUP_RANK}
    const at = new Date(activityAt)
    const day = startOfDay(at.getTime())
    // NEGATED so the newest day sorts first, in the one ascending order every grouping shares.
    const rank = -day
    const days = Math.round((startOfDay(now) - day) / DAY)
    if (days <= 0) return {key: "date:today", label: "Today", rank}
    if (days === 1) return {key: "date:yesterday", label: "Yesterday", rank}
    const year = at.getFullYear()
    const label = `${MONTHS[at.getMonth()]} ${at.getDate()}${
        year === new Date(now).getFullYear() ? "" : `, ${year}`
    }`
    // Keyed by the calendar day, not the label: two Augusts a year apart must not share a heading.
    return {key: `date:${year}-${at.getMonth() + 1}-${at.getDate()}`, label, rank}
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
): SessionGroupBucket => {
    if (ref.pinned) return {key: PINNED_GROUP_KEY, label: "Pinned", rank: PINNED_GROUP_RANK}
    if (groupBy === "none") return {key: "recent", label: "Recent", rank: 1}
    if (groupBy === "date") return dateBucket(ref.activityAt, now)
    if (groupBy === "status") {
        // A gate ranks above liveness, the same rule the status FILTER applies — without its own
        // bucket a session waiting on you fell into Idle (or Live), where the amber dot contradicts
        // the heading. Order mirrors the filter: Running, Awaiting input, Live, Idle.
        if (ref.running) return {key: "status:running", label: "Running", rank: 0}
        if (ref.waiting) return {key: "status:waiting", label: "Awaiting input", rank: 1}
        return ref.alive
            ? {key: "status:live", label: "Live", rank: 2}
            : {key: "status:idle", label: "Idle", rank: 3}
    }
    // Agents share a rank and sort by name; only "No agent yet" is pushed past them.
    if (!ref.agentId) return {key: UNASSIGNED_GROUP_KEY, label: "No agent yet", rank: 1}
    // `||`, not `??`: an artifact whose name resolves to "" must still get a heading you can read.
    return {key: `agent:${ref.agentId}`, label: ref.agentName?.trim() || "Agent", rank: 0}
}

/** Ascending by rank, ties broken by label. */
const compareGroups = (a: {label: string; rank: number}, b: {label: string; rank: number}) =>
    a.rank - b.rank || a.label.localeCompare(b.label)

/** The entity reads the bucket off the row — resolved upstream, so a `groupBy` change flows. */
export const sidebarSessionGroupKey = (ref: SessionSidebarRef): string =>
    ref.groupKey ?? PINNED_GROUP_KEY

/**
 * Which zones each grouping offers.
 *
 * Module-level constants, NOT built inline: `withEntityGroups` spreads this object into the source
 * and `useMobileNavItems` memoizes on its identity, so a fresh closure per evaluation would defeat
 * that memo. Date and flat groupings offer nothing — their order MEANS something (a calendar, an
 * activity run), and overriding it would make the heading lie.
 */
const SESSION_REORDER_ZONES: Partial<Record<SidebarSessionGroupBy, SidebarEntityReorder>> = {
    agent: {
        // The headings arrange the SHARED agent zone — the Agents group's own list.
        groupZone: SIDEBAR_AGENT_ORDER_ZONE,
        rowZone: (key) =>
            key.startsWith("agent:") && key !== UNASSIGNED_GROUP_KEY
                ? sidebarSessionZone(key)
                : undefined,
    },
    status: {
        groupZone: SIDEBAR_STATUS_GROUP_ZONE,
        rowZone: (key) => (key.startsWith("status:") ? sidebarSessionZone(key) : undefined),
    },
}

/**
 * The group headings the Sessions rows sit under, in a fixed order: Pinned first, then whatever
 * the grouping ranks. Ordering only — `resolveChildren` owns the row cap, so a group whose rows
 * all fall outside it is dropped there rather than here.
 */
export const sidebarSessionGroupsAtomFamily = atomFamily((scopeId: string) =>
    atom((get) => {
        const refs = get(sidebarSessionRefsAtomFamily(scopeId))
        const labels = new Map<string, {label: string; rank: number}>()
        for (const ref of refs) {
            const key = sidebarSessionGroupKey(ref)
            if (!labels.has(key)) {
                labels.set(key, {label: ref.groupLabel ?? "Other", rank: ref.groupRank ?? 0})
            }
        }
        const groupBy = get(sidebarSessionFiltersAtomFamily(scopeId)).groupBy
        // Under AGENT grouping, order the headings by the SAME chat-session rank the Agents group
        // uses — so the two agent lists agree and the busiest agent leads, not the alphabetical
        // first. Frozen per page load like that rank, so headings do not reshuffle as you work.
        // Pinned still leads and "No agent yet" still trails (their ranks are untouched).
        if (groupBy === "agent") {
            const ranks = get(sidebarAgentRanksAtomFamily(scopeId))
            for (const [key, bucket] of labels) {
                if (!key.startsWith("agent:") || key === UNASSIGNED_GROUP_KEY) continue
                // NEGATED so more sessions sorts first, in the one ascending order compareGroups uses.
                bucket.rank = -(ranks.get(key.slice("agent:".length)) ?? 0)
            }
        }
        // SORTED, not first-seen: the rows arrive in activity order, so taking their order made the
        // headings reshuffle every time you worked in a session. Only the rows under a heading move.
        const sorted: SidebarEntityGroup[] = [...labels]
            .sort(([, a], [, b]) => compareGroups(a, b))
            .map(([key, {label}]) => ({key, label}))
        // Only the status headings are hand-arrangeable. Pinned is not a status and never moves;
        // agent headings arrange through the shared agent rank instead, so they are already sorted.
        const all =
            groupBy === "status"
                ? [
                      ...sorted.filter((group) => group.key === PINNED_GROUP_KEY),
                      ...applyManualOrder(
                          sorted.filter((group) => group.key !== PINNED_GROUP_KEY),
                          (group) => group.key,
                          get(sidebarManualOrderAtomFamily(SIDEBAR_STATUS_GROUP_ZONE)),
                          "trail",
                      ),
                  ]
                : sorted
        // "None" still separates the pins — a pinned conversation is one you keep coming back to,
        // and burying it in the run of recent rows is what the heading exists to prevent. With no
        // pins there is nothing to separate, so the list goes fully flat.
        //
        // ALL of the row keys or NONE of them: `groupedChildren` renders group by group and drops
        // any row whose key it was not given, so emitting just the pinned group hid every other
        // row (the rail showed pins alone). Rows carry `pinned` or `recent` under this grouping,
        // and both are in `labels` already — the filter below only decides between the two.
        const groups: SidebarEntityGroup[] =
            groupBy === "none" && !labels.has(PINNED_GROUP_KEY) ? [] : all
        const dirty = get(sidebarSessionFiltersDirtyAtomFamily(scopeId))
        // Headings open by default; the stored set is what you folded, and it survives a
        // regrouping because it holds no grouping's keys of its own.
        const toggled = new Set(get(sidebarSessionToggledGroupsAtomFamily(scopeId)))
        return {
            groups,
            collapsedKeys: groups.filter((g) => toggled.has(g.key)).map((g) => g.key),
            // Say WHY the group is empty: with a filter on, "No sessions" reads as "you have none".
            emptyLabel: dirty ? "No sessions match these filters" : undefined,
            reorder: SESSION_REORDER_ZONES[groupBy],
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
        const data = get(sidebarSessionRefsAtomFamily(scopeId))
        return {
            data,
            // Only pending with nothing to show. Pinning a session mints a NEW pinned-query key,
            // and reporting that first flight as pending emptied the whole rail for a frame —
            // every row vanished and came back reordered.
            isPending: (query.isPending || (hasPins && pinnedQuery.isPending)) && !data.length,
            isError: query.isError || pinnedFailed,
            error: query.error ?? (pinnedFailed ? pinnedQuery.error : null) ?? null,
        }
    }),
)

/**
 * Is the Sessions group open enough to read its list from outside it?
 *
 * `alwaysOpen` HAS to be in this test: Sessions is rendered always-open on desktop, so its key is
 * never written to the persisted open set — reading only that set left the Agent facet with no
 * options to offer. `idleReadyAtom` holds every such read until after first paint.
 */
const sessionsGroupOpen = (get: Getter, scopeId: string): boolean => {
    const alwaysOpen = get(sidebarAlwaysOpenGroupsAtomFamily(scopeId)).includes(
        SESSIONS_SIDEBAR_KEY,
    )
    const inlineOpen = (get(sidebarOpenGroupsAtomFamily(scopeId)) ?? []).includes(
        SESSIONS_SIDEBAR_KEY,
    )
    const popupOpen = get(sidebarPopupGroupsAtomFamily(scopeId)).includes(SESSIONS_SIDEBAR_KEY)
    return (alwaysOpen || inlineOpen || popupOpen) && get(idleReadyAtom)
}

/** The window the agent ranking counts over. The server caps a page at 200; a project with more
 * sessions than this ranks its long tail by catalog order, which is stable and good enough. */
const AGENT_RANK_WINDOW = 200

/**
 * Every agent's sessions, UNFILTERED — the query that ranks the Agents group.
 *
 * Its own request, not the rail's rows: the rail's list carries the session filters, so ranking
 * off it let a filter (one agent, one status, a narrower window) reorder the Agents group — a
 * filter is not a use. Project-scoped, origin-agnostic, no activity floor.
 *
 * FROZEN per page load — `staleTime`/`gcTime: Infinity`, no focus refetch, no interval — so the
 * order an agent lives at does not shift while you work: a new session bumps nothing until you
 * reload. Agents are spatial memory, and a list that reshuffles under you loses that. Gated like
 * the facet, so a closed Sessions group fetches nothing.
 */
const sidebarAgentActivityQueryAtomFamily = atomFamily((scopeId: string) =>
    atomWithQuery<SessionStream[] | null>((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: ["sidebar-agent-activity", projectId],
            queryFn: ({signal}) =>
                querySessions({
                    projectId: projectId ?? "",
                    includeArchived: false,
                    // CHATS only, not trigger runs: an agent that fires on a schedule would
                    // otherwise rank on runs you never created, mismatching the handful of
                    // conversations you actually had with it.
                    excludeOrigin: "trigger",
                    limit: AGENT_RANK_WINDOW,
                    order: "descending",
                    abortSignal: signal,
                    lowPriority: true,
                }),
            enabled: Boolean(projectId) && sessionsGroupOpen(get, scopeId),
            staleTime: Infinity,
            gcTime: Infinity,
            refetchOnWindowFocus: false,
        }
    }),
)

/**
 * `agentId -> chat-session count`, ranking the Agents group by how much you actually work with
 * each agent.
 *
 * CHATS only — the query above excludes trigger runs — so an automation-heavy agent ranks on the
 * conversations you had, not the runs a schedule fired. A busy agent leads, the count barely moves
 * session to session (stable, unlike recency), and an agent with no chat keeps catalog order at
 * the bottom — a new one appends rather than jumping in. Counted over the frozen window above.
 */
export const agentSessionCounts = (rows: readonly SessionStream[]): ReadonlyMap<string, number> => {
    const counts = new Map<string, number>()
    for (const row of rows) {
        const agentId = sessionOpenTarget(row)?.appId
        if (!agentId) continue
        counts.set(agentId, (counts.get(agentId) ?? 0) + 1)
    }
    return counts
}

export const sidebarAgentRanksAtomFamily = atomFamily((scopeId: string) =>
    atom((get) =>
        // A hand-arranged agent outranks any count. Folded in HERE, not at each call site: the
        // Agents group and the agent headings both read this atom, so they cannot disagree.
        withManualAgentRanks(
            agentSessionCounts(get(sidebarAgentActivityQueryAtomFamily(scopeId)).data ?? []),
            get(sidebarManualOrderAtomFamily(SIDEBAR_AGENT_ORDER_ZONE)),
        ),
    ),
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
        if (!sessionsGroupOpen(get, scopeId)) return []

        const agents = get(agentWorkflowsListQueryStateAtom)
        return agents.data.map((agent) => ({
            value: agent.id,
            label: agent.name || agent.slug || "Untitled agent",
        }))
    }),
)
