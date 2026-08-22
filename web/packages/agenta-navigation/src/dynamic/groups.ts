import type {SidebarEntityGroup, SidebarEntitySource} from "./types"

/**
 * Folds an entity's heading descriptor onto its source.
 *
 * Only while the source is `ready`: a heading over a loading or empty group says nothing, and
 * shared by both hosts so the desktop registry and the mobile drawer cannot drift on the rule.
 */
export const withEntityGroups = (
    source: SidebarEntitySource,
    groups:
        | {groups: SidebarEntityGroup[]; collapsedKeys: string[]; emptyLabel?: string}
        | undefined
        | null,
): SidebarEntitySource => (groups && source.status === "ready" ? {...source, ...groups} : source)
