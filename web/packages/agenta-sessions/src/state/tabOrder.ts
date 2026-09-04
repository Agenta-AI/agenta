import {useEffect} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {atom, useAtomValue, useSetAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"
import {atomFamily} from "jotai-family"

/**
 * A hand-arranged session order, per project + scope (an agent, or the whole project).
 *
 * Local-only, same call as [pins]: the server could hold this (`session_streams.tags`), but
 * reconciling one user's arrangement across devices is the part worth designing rather than
 * improvising. This module is the port — nothing outside it knows where the order lives.
 *
 * Only surfaces where the user can ARRANGE sessions write here (the tab rail). A list that is
 * sorted by something real — activity, status — has no business reading it.
 */
const orderByScopeAtom = atomWithStorage<Record<string, string[]>>("agenta:sessions:tab-order", {})

/** Scope key: an agent's rail is arranged separately from another agent's. */
const scopeKey = (projectId: string, scope: string) => `${projectId}:${scope}`

export const sessionTabOrderAtomFamily = atomFamily((scope: string) =>
    atom<string[]>((get) => {
        const projectId = get(projectIdAtom)
        return projectId ? (get(orderByScopeAtom)[scopeKey(projectId, scope)] ?? []) : []
    }),
)

export const setSessionTabOrderAtom = atom(
    null,
    (get, set, {scope, ids}: {scope: string; ids: string[]}) => {
        const projectId = get(projectIdAtom)
        if (!projectId) return
        set(orderByScopeAtom, {...get(orderByScopeAtom), [scopeKey(projectId, scope)]: ids})
    },
)

/**
 * Sorts rows by a hand-arranged order. Ids the order has never seen TRAIL: the base order is the
 * server's activity window, so leading them made a session jump to the head of the rail the moment
 * any turn touched it (#6544). `useSessionTabOrderSeed` appends them to the order for good.
 */
export const applySessionTabOrder = <T extends {id: string}>(rows: T[], order: string[]): T[] => {
    if (order.length === 0) return rows
    const rank = new Map(order.map((id, index) => [id, index]))
    const known: T[] = []
    const fresh: T[] = []
    for (const row of rows) (rank.has(row.id) ? known : fresh).push(row)
    known.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
    return [...known, ...fresh]
}

/**
 * Seeds the saved order from the first rows a rail observes, and appends every id it has not seen
 * since.
 *
 * Until this existed the order stayed empty until the user hand-dragged once, so nothing held the
 * rail still: its base order is `updated_at desc`, refetched on focus and on a 30s stale window,
 * and any turn in any session reshuffled the tabs (#6544). Placed ids keep their slot — this only
 * ever appends, so it can never undo an arrangement.
 */
export const useSessionTabOrderSeed = (scope: string, ids: readonly string[]) => {
    const saved = useAtomValue(sessionTabOrderAtomFamily(scope))
    const setOrder = useSetAtom(setSessionTabOrderAtom)
    useEffect(() => {
        if (ids.length === 0) return
        const placed = new Set(saved)
        const unseen = ids.filter((id) => !placed.has(id))
        if (unseen.length === 0) return
        setOrder({scope, ids: [...saved, ...unseen]})
    }, [ids, saved, scope, setOrder])
}
