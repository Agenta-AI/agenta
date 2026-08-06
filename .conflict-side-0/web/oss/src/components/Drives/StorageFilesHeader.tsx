/**
 * StorageFilesHeader — the right-side content of the config panel's "Files" header bar.
 *
 * Mirrors the sibling Triggers header's count, and doubles as the "browse all" entry: clicking it
 * opens the Files drawer at the tree root (the body's rows open the same drawer preselected on a
 * file). Slotted into the entity-ui `AgentOperationsSections` header by the app layer, which owns
 * the chat session state that package can't reach.
 */
import {CircleNotch, FolderOpen} from "@phosphor-icons/react"
import {Skeleton} from "antd"
import {useSetAtom} from "jotai"

import {configFilesDrawerAtomFamily, useConfigDrive} from "./configDrive"
import {DriveWarningBadge, FOCUS_RING} from "./DriveFileRow"

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
    // "N+" when the count scan hit its cap on a very large tree (a floor, not exact).
    const shown = `${count}${drive.fileCountCapped ? "+" : ""}`
    const label = count === 1 && !drive.fileCountCapped ? "1 file" : `${shown} files`

    if (count === 0) {
        // Zero files but a mount failed (e.g. the agent mount errored over an empty session) → a plain
        // "No files" would hide the failure, so badge the folder icon and keep it a button into the
        // drawer (where the retry lives). A clean empty just reads "No files".
        if (drive.partialErrored) {
            return (
                <button
                    type="button"
                    onClick={(e) => {
                        e.currentTarget.blur()
                        setDrawer({open: true, initialPath: null, staged: []})
                    }}
                    className={`flex cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-1 py-0.5 text-xs text-[var(--ag-colorTextTertiary)] transition-colors hover:text-[var(--ag-colorText)] ${FOCUS_RING}`}
                >
                    No files
                    <DriveWarningBadge show>
                        <FolderOpen size={13} />
                    </DriveWarningBadge>
                </button>
            )
        }
        return <span className="text-xs text-[var(--ag-colorTextTertiary)]">No files</span>
    }

    return (
        <button
            type="button"
            // Blur on open so the drawer's ESC-close doesn't restore a (keyboard-modality) focus ring
            // to this trigger. Genuine Tab focus still shows the ring via FOCUS_RING.
            onClick={(e) => {
                e.currentTarget.blur()
                setDrawer({open: true, initialPath: null, staged: []})
            }}
            className={`flex cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-1 py-0.5 text-xs text-[var(--ag-colorTextTertiary)] transition-colors hover:text-[var(--ag-colorText)] ${FOCUS_RING}`}
        >
            {/* The count survives a session switch (React Query keeps the swapped mount's last-known
                value while it revalidates), so a spinner signals the shown count is being refreshed —
                without it, a switch looks frozen on the previous session's number. */}
            {drive.isFetching ? (
                <CircleNotch size={11} className="animate-spin" aria-label="Refreshing" />
            ) : null}
            {label}
            {/* Opens the Files drawer (a side panel), NOT a new tab — a folder-open glyph, not the
                external-link arrow that read as "leaves the page". A mount failure badges this folder
                (the button already opens the drawer, where the retry lives). */}
            <DriveWarningBadge show={drive.partialErrored}>
                <FolderOpen size={13} />
            </DriveWarningBadge>
        </button>
    )
}
