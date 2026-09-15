/**
 * The tab rail's rows — the open-tab set fetched BY ID, so a chip's existence is decided by the
 * user's open set alone and never by which rows a capped, grouped list happens to carry.
 *
 * The rail used to filter `useSessionCardList` down to its open ids. That list excludes waiting
 * and pinned sessions (they come from sibling queries), hides unstarted ones, and caps at N; every
 * one of those transitions dropped a session out of the result for a fetch, and its tab blinked
 * out with it. Membership and data are separate questions, and this answers only the second.
 */
import {useMemo} from "react"

import {type SessionExpansion} from "@agenta/entities/session"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import {sessionRowVm, type SessionRowVm} from "../row/viewModel"

import {pinnedSessionIdsAtom} from "./pins"
import {type SessionListRequestPolicy} from "./sessionListPolicy"
import {
    pendingBySessionId,
    rowsFromPages,
    useActionableInteractions,
    useSessionList,
    type SessionListOptions,
} from "./useSessionList"

/**
 * Request args for the rail's by-id fetch. Origin is `all` and `trigger` is expanded for the same
 * reason pins do it: an open tab is an explicit user choice, so the surface's origin filter must
 * not hide it, and an automation session's title has to resolve. Disabled on an empty set — a
 * query with no ids would read as "no restriction" and page the whole project.
 */
export function sessionTabListArgs(
    policy: SessionListRequestPolicy,
    agentId: string | undefined,
    ids: readonly string[],
): SessionListOptions {
    return {
        originPolicy: "all",
        expansions: Array.from(new Set<SessionExpansion>([...policy.expansions, "trigger"])),
        agentId,
        sessionIds: [...ids],
        enabled: ids.length > 0,
    }
}

/**
 * Whether the rail is still waiting on its first rows. A disabled query (no ids yet) reports
 * `pending` forever, so it must not count — an agent with no sessions has nothing to wait for.
 */
export const sessionTabRowsPending = (idCount: number, queryPending: boolean): boolean =>
    idCount > 0 && queryPending

export interface SessionTabRows {
    rows: SessionRowVm[]
    /** The first fetch for a non-empty set has not landed. */
    isPending: boolean
}

export const useSessionTabRows = ({
    policy,
    agentId,
    ids,
}: {
    policy: SessionListRequestPolicy
    agentId?: string
    /** The open-tab set. Null before it is seeded — nothing is fetched. */
    ids: readonly string[] | null
}): SessionTabRows => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const pinnedIds = useAtomValue(pinnedSessionIdsAtom)
    const requested = ids ?? []

    // Same poll the lists read, so a chip's "waiting" dot agrees with the sidebar's row.
    const interactions = useActionableInteractions(projectId)
    const pendingBySession = useMemo(
        () => pendingBySessionId(interactions.data),
        [interactions.data],
    )
    const query = useSessionList(sessionTabListArgs(policy, agentId, requested))

    const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds])
    const rows = useMemo(
        () =>
            rowsFromPages(query.data?.pages).map((row) =>
                sessionRowVm(row, {
                    pinned: pinnedSet.has(row.session_id),
                    pending: pendingBySession?.get(row.session_id),
                }),
            ),
        [query.data?.pages, pinnedSet, pendingBySession],
    )

    return {rows, isPending: sessionTabRowsPending(requested.length, query.isPending)}
}
