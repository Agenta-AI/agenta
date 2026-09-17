/** Folder-content order: folders first (by name), then files by the sort key. */
import {compareFoldersFirstByName, type DriveTreeNode} from "./driveTree"
import {type DriveSortKey} from "./useDriveFilters"

const byName = (a: DriveTreeNode, b: DriveTreeNode) => a.name.localeCompare(b.name)

const compareFiles = (sort: DriveSortKey) => (a: DriveTreeNode, b: DriveTreeNode) => {
    if (sort === "modified") {
        const d = (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0)
        if (d !== 0) return d
    } else if (sort === "size") {
        const d = (b.size ?? 0) - (a.size ?? 0)
        if (d !== 0) return d
    }
    return byName(a, b)
}

/** `pinned` paths lead in the given order whatever the sort: a just-created entry stays put through
 * its naming instead of jumping to wherever its new name lands. */
export const sortDriveEntries = (
    nodes: DriveTreeNode[],
    sort: DriveSortKey,
    pinned: readonly string[] = [],
): DriveTreeNode[] => {
    const rest = pinned.length ? nodes.filter((n) => !pinned.includes(n.path)) : nodes
    const cmp = compareFiles(sort)
    const ordered =
        sort === "name"
            ? [...rest].sort(compareFoldersFirstByName)
            : [...rest].sort((a, b) => {
                  if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
                  return a.isFolder ? byName(a, b) : cmp(a, b)
              })
    if (!pinned.length) return ordered
    const byPath = new Map(nodes.map((n) => [n.path, n]))
    const lead = pinned.map((p) => byPath.get(p)).filter((n): n is DriveTreeNode => !!n)
    return [...lead, ...ordered]
}
