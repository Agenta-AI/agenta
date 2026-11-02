/**
 * Bounded, most-recently-written maps for the small `{workflowId: …}` records we keep in
 * localStorage. Shared by `persistedAgentType` and `agentIcon`, which both need the same trim and
 * the same subtle ordering rule.
 */

/**
 * Write `key` and keep at most `max` entries, dropping the least recently written.
 *
 * The delete is not redundant: assigning to an existing key keeps its ORIGINAL insertion position,
 * and the trim slices by that order — so without the delete a full map can discard the entry just
 * written. JSON preserves string-key insertion order, so the order survives a round trip.
 */
export function writeBounded<T>(
    map: Record<string, T>,
    key: string,
    value: T | null,
    max: number,
): Record<string, T> {
    const next = {...map}
    delete next[key]
    if (value !== null) next[key] = value

    const keys = Object.keys(next)
    if (keys.length <= max) return next
    return Object.fromEntries(keys.slice(keys.length - max).map((k) => [k, next[k]] as const))
}
