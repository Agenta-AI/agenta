import type {
    SidebarEntityGroup,
    SidebarEntityRef,
    SidebarEntityReorder,
    SidebarEntitySource,
} from "./types"

/**
 * Folds an entity's heading descriptor onto its source.
 *
 * Only while the source is `ready`: a heading over a loading or empty group says nothing, and
 * shared by both hosts so the desktop registry and the mobile drawer cannot drift on the rule.
 */
export const withEntityGroups = (
    source: SidebarEntitySource,
    groups:
        | {
              groups: SidebarEntityGroup[]
              collapsedKeys: string[]
              emptyLabel?: string
              reorder?: SidebarEntityReorder
          }
        | undefined
        | null,
): SidebarEntitySource => (groups && source.status === "ready" ? {...source, ...groups} : source)

/**
 * Reorders a source's rows by recency, newest first.
 *
 * `rankOf` returns a timestamp in ms, or `undefined` where there is none. Rows without one keep
 * the source's own order among themselves and sit AFTER every ranked row — a missing timestamp
 * means "not used recently", not "used at the epoch". The sort is stable: equal ranks stay in the
 * order they arrived, so a reordering never looks arbitrary.
 */
export const withRefsByRecency = (
    source: SidebarEntitySource,
    rankOf: (ref: SidebarEntityRef) => number | undefined,
): SidebarEntitySource => {
    if (source.status !== "ready" || source.refs.length < 2) return source
    const ranked = source.refs.map((ref, index) => ({ref, index, at: rankOf(ref)}))
    ranked.sort((a, b) => {
        if (a.at === b.at) return a.index - b.index
        if (a.at === undefined) return 1
        if (b.at === undefined) return -1
        return b.at - a.at
    })
    // Already in order — hand back the same object so a memo downstream keeps holding.
    if (ranked.every((entry, index) => entry.index === index)) return source
    return {...source, refs: ranked.map((entry) => entry.ref)}
}
