/**
 * StorageFilesHeader — the right-side content of the config panel's "Files" header bar.
 *
 * Mirrors the sibling Triggers header's count, and doubles as the "browse all" entry: clicking it
 * opens the DriveDrawer at the tree root (the body's rows open the same drawer preselected on a
 * file). Slotted into the entity-ui `AgentOperationsSections` header by the app layer, which owns
 * the chat session state that package can't reach.
 */
import {ArrowSquareOut} from "@phosphor-icons/react"
import {Skeleton} from "antd"
import {useSetAtom} from "jotai"

import {configFilesDrawerAtomFamily, useConfigDrive} from "./configDrive"

export default function StorageFilesHeader({revisionId}: {revisionId?: string | null}) {
    const {drive} = useConfigDrive(revisionId)
    const setDrawer = useSetAtom(configFilesDrawerAtomFamily(revisionId ?? ""))

    if (drive.isLoading) {
        return <Skeleton.Button active size="small" style={{width: 44, height: 14}} />
    }

    if (drive.errored) {
        return <span className="text-xs text-[var(--ag-colorTextTertiary)]">Unavailable</span>
    }

    const count = drive.fileCount
    const label = count === 1 ? "1 file" : `${count} files`

    if (count === 0) {
        return <span className="text-xs text-[var(--ag-colorTextTertiary)]">No files</span>
    }

    return (
        <button
            type="button"
            onClick={() => setDrawer({open: true, initialPath: null})}
            className="flex cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-1 py-0.5 text-xs text-[var(--ag-colorTextTertiary)] transition-colors hover:text-[var(--ag-colorText)]"
        >
            {label}
            <ArrowSquareOut size={12} weight="bold" />
        </button>
    )
}
