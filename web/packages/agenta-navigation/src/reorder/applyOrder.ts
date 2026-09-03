/**
 * Pure ordering helpers behind the sidebar's hand-arranged order. No jotai, no DOM — the
 * persistence port ({@link ../reorder/manualOrder}) and the drag engine both call into here.
 */

/** How an id the saved order has never seen sorts against the ones it has. */
export type UnknownPlacement = "lead" | "trail"

/**
 * Sorts rows by a hand-arranged order.
 *
 * `unknown` differs by surface deliberately. A SESSION the order has not seen leads — you just
 * started it, and it is the one you are about to use (the call `applySessionTabOrder` already
 * makes). An AGENT or a status heading trails: arranging is how you promote an agent, so one you
 * never placed must not displace the ones you did.
 */
export const applyManualOrder = <T>(
    rows: readonly T[],
    idOf: (row: T) => string,
    order: readonly string[],
    unknown: UnknownPlacement,
): T[] => {
    if (!order.length || rows.length < 2) return [...rows]
    const rank = new Map(order.map((id, index) => [id, index]))
    const known: T[] = []
    const rest: T[] = []
    for (const row of rows) (rank.has(idOf(row)) ? known : rest).push(row)
    if (!known.length) return [...rows]
    known.sort((a, b) => (rank.get(idOf(a)) ?? 0) - (rank.get(idOf(b)) ?? 0))
    return unknown === "lead" ? [...rest, ...known] : [...known, ...rest]
}

/**
 * Folds the arrangement of the ids ON SCREEN back into the saved list.
 *
 * Ids the saved order holds but the rail is not showing — filtered out, past the row cap, on the
 * other host — keep their saved slot; the visible ids refill the slots they occupied, in their new
 * order. This is load-bearing, not defensive: the agent zone is written from two surfaces with
 * different visible sets (the Agents group renders 5 rows, the agent headings render every agent
 * with sessions), so a visible-only write from the capped group would truncate a longer
 * arrangement on the first drop. Same rule as `reorderSessionsAtomFamily`: a drop rearranges, it
 * never deletes.
 */
export const mergeManualOrder = (
    saved: readonly string[],
    visible: readonly string[],
): string[] => {
    if (!saved.length) return [...visible]
    const onScreen = new Set(visible)
    const queue = [...visible]
    const next: string[] = []
    for (const id of saved) {
        if (!onScreen.has(id)) {
            next.push(id)
            continue
        }
        const replacement = queue.shift()
        if (replacement !== undefined) next.push(replacement)
    }
    const placed = new Set(next)
    for (const id of queue) if (!placed.has(id)) next.push(id)
    return next
}

/** Above any plausible chat-session count, so a manual placement always beats activity. */
const MANUAL_RANK_BASE = 1_000_000

/**
 * Chat-session counts with the hand-arranged agents lifted above them.
 *
 * One map for every agent surface: the Agents group's rows and the agent headings under Sessions
 * read the same atom, so an arrangement applied here cannot be applied twice or disagree between
 * the two. `withRefsByRecency` sorts descending (manual first, then counted, then uncounted in
 * catalog order); `sidebarSessionGroupsAtomFamily` negates the same value into its ascending sort,
 * landing manual headings below every real bucket rank but above Pinned and below "No agent yet".
 */
export const withManualAgentRanks = (
    counts: ReadonlyMap<string, number>,
    order: readonly string[],
): ReadonlyMap<string, number> => {
    if (!order.length) return counts
    const ranks = new Map(counts)
    order.forEach((id, index) => ranks.set(id, MANUAL_RANK_BASE - index))
    return ranks
}

/** Moves `id` one slot within `ids`. Returns null when the move would leave the list. */
export const movedManualOrder = (
    ids: readonly string[],
    id: string,
    delta: -1 | 1,
): string[] | null => {
    const from = ids.indexOf(id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= ids.length) return null
    const next = [...ids]
    next[from] = next[to]
    next[to] = id
    return next
}
