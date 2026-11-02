/** Folder-content order: folders first, then files, each group by the sort key. */
import {compareFoldersFirstByName, type DriveTreeNode} from "./driveTree"
import {type DriveSortKey} from "./useDriveFilters"

const byName = (a: DriveTreeNode, b: DriveTreeNode) => a.name.localeCompare(b.name)

// Newest first; entries without a time (a folder the listing gave none for) keep name order at the end.
const byModified = (a: DriveTreeNode, b: DriveTreeNode) =>
    (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0) || byName(a, b)

const compare = (sort: DriveSortKey) => (a: DriveTreeNode, b: DriveTreeNode) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
    if (sort === "modified") return byModified(a, b)
    if (sort === "size" && !a.isFolder) return (b.size ?? 0) - (a.size ?? 0) || byName(a, b)
    return byName(a, b)
}

export const sortDriveEntries = (nodes: DriveTreeNode[], sort: DriveSortKey): DriveTreeNode[] =>
    sort === "name" ? [...nodes].sort(compareFoldersFirstByName) : [...nodes].sort(compare(sort))
