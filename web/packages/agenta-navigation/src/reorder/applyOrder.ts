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
 * order. This is load-bearing, not defensive: a zone's rows are filtered, windowed by the fetch,
 * and capped before render, so what is on screen is routinely a subset of what has been arranged.
 * A visible-only write would discard the rest on the first drop made under a filter. Same rule as
 * `reorderSessionsAtomFamily`: a drop rearranges, it never deletes.
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

/**
 * Trims a saved order to `cap`, dropping the ids that are NOT on screen first.
 *
 * A blind trim drops whatever sits past the cap, which after paging is routinely a row the user
 * is looking at — and `applyManualOrder(…, "lead")` then hoists every dropped row to the top of
 * its bucket, so one drop reorders the list. Evicting from the tail of the off-screen ids keeps
 * every visible row placed, and only forgets arrangements for rows nobody can currently see.
 */
export const capManualOrder = (
    order: readonly string[],
    visible: readonly string[],
    cap: number,
): string[] => {
    if (order.length <= cap) return [...order]
    const onScreen = new Set(visible)
    const evictable: number[] = []
    order.forEach((id, index) => {
        if (!onScreen.has(id)) evictable.push(index)
    })
    // Newest arrangements sit at the tail, so evict from the end of the off-screen set first.
    const dropped = new Set(evictable.slice(-(order.length - cap)))
    const kept = order.filter((_, index) => !dropped.has(index))
    // More visible ids than the cap allows: nothing off-screen is left to give, so trim the tail.
    return kept.length > cap ? kept.slice(0, cap) : kept
}

/**
 * Sorts rows by a hand-arranged order, placing rows the order has never seen by ACTIVITY.
 *
 * `applyManualOrder(…, "lead")` treats every unseen session as newly started. That holds for the
 * head of the list and breaks the moment a later page arrives: those rows are OLDER than anything
 * arranged, and leading would hoist a page of stale sessions over the arrangement. Only a row
 * newer than everything already known is a new session; anything older trails.
 */
export const applyManualOrderByActivity = <T>(
    rows: readonly T[],
    idOf: (row: T) => string,
    activityOf: (row: T) => string | null | undefined,
    order: readonly string[],
): T[] => {
    if (!order.length || rows.length < 2) return [...rows]
    const rank = new Map(order.map((id, index) => [id, index]))
    const known: T[] = []
    const unknown: T[] = []
    for (const row of rows) (rank.has(idOf(row)) ? known : unknown).push(row)
    if (!known.length || !unknown.length) {
        return known.length
            ? [
                  ...known.sort((a, b) => (rank.get(idOf(a)) ?? 0) - (rank.get(idOf(b)) ?? 0)),
                  ...unknown,
              ]
            : [...rows]
    }
    known.sort((a, b) => (rank.get(idOf(a)) ?? 0) - (rank.get(idOf(b)) ?? 0))
    let newest: string | undefined
    for (const row of known) {
        const at = activityOf(row)
        if (at && (!newest || at > newest)) newest = at
    }
    const leads: T[] = []
    const trails: T[] = []
    for (const row of unknown) {
        const at = activityOf(row)
        // No activity is not evidence of newness — a row that cannot prove it is newer trails.
        ;(newest && at && at > newest ? leads : trails).push(row)
    }
    return [...leads, ...known, ...trails]
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
