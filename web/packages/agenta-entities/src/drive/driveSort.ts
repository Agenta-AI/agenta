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

export const sortDriveEntries = (nodes: DriveTreeNode[], sort: DriveSortKey): DriveTreeNode[] => {
    if (sort === "name") return [...nodes].sort(compareFoldersFirstByName)
    const cmp = compareFiles(sort)
    return [...nodes].sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
        return a.isFolder ? byName(a, b) : cmp(a, b)
    })
}
