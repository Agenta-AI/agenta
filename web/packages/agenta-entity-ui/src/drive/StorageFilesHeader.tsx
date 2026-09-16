/**
 * StorageFilesHeader — the right-side content of the config panel's "Files" header bar.
 *
 * Mirrors the sibling Triggers header's count, and doubles as the "browse all" entry: clicking it
 * opens the docked Files pane at its root (the body's rows open it on one file instead).
 * Slotted into the entity-ui `AgentOperationsSections` header by the app layer, which owns the
 * chat session state that package can't reach.
 */
import {useConfigDrive} from "@agenta/entities/drive"
import {ConfigRowTrailing} from "@agenta/ui/components/presentational"
import {SkeletonBlock} from "@agenta/ui/ui"
import {CircleNotch, FolderOpen} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {DriveWarningBadge, FOCUS_RING} from "./DriveFileRow"
import {driveQuickLookAtomFamily} from "./quickLook"
import {sessionFilesPaneOpenAtomFamily} from "./SessionFilesPane"

// `-mr-1` bleeds the hit area's right padding outward so the folder glyph, not the padding, lands
// on the panel's affordance axis.
const BROWSE_BUTTON = `-mr-1 flex cursor-pointer items-center rounded border-0 bg-transparent px-1 py-0.5 text-xs text-[var(--ag-colorTextTertiary)] transition-colors hover:text-[var(--ag-colorText)] ${FOCUS_RING}`

export default function StorageFilesHeader({
    revisionId,
    sessionId,
    scope,
}: {
    revisionId?: string | null
    /** The conversation whose drive this is. The host resolves it; empty = no conversation. */
    sessionId?: string | null
    /** The pane's scope key, for a host whose session id can be empty (a fresh tab). */
    scope?: string | null
}) {
    const {drive} = useConfigDrive(revisionId, sessionId)
    // A root quick look on the session opens the docked pane; without a session, the scope flag.
    const setQuickLook = useSetAtom(driveQuickLookAtomFamily(sessionId ?? ""))
    const setScopeOpen = useSetAtom(sessionFilesPaneOpenAtomFamily(scope ?? ""))
    const openPane = () => {
        if (sessionId) setQuickLook({path: ""})
        else if (scope) setScopeOpen(true)
    }

    if (drive.isLoading) {
        return (
            <ConfigRowTrailing>
                <SkeletonBlock className="h-[14px] w-[44px]" />
            </ConfigRowTrailing>
        )
    }

    if (drive.errored) {
        return (
            <ConfigRowTrailing>
                <span className="text-xs text-[var(--ag-colorTextTertiary)]">Unavailable</span>
            </ConfigRowTrailing>
        )
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
                        openPane()
                    }}
                    className={BROWSE_BUTTON}
                >
                    <ConfigRowTrailing
                        affordance={
                            <DriveWarningBadge show>
                                <FolderOpen size={13} />
                            </DriveWarningBadge>
                        }
                    >
                        No files
                    </ConfigRowTrailing>
                </button>
            )
        }
        return (
            <ConfigRowTrailing>
                <span className="text-xs text-[var(--ag-colorTextTertiary)]">No files</span>
            </ConfigRowTrailing>
        )
    }

    return (
        <button
            type="button"
            // Blur on open so focus doesn't sit under the opened pane.
            onClick={(e) => {
                e.currentTarget.blur()
                openPane()
            }}
            className={BROWSE_BUTTON}
        >
            <ConfigRowTrailing
                // A folder-open glyph, not an external-link arrow; a mount failure badges it.
                affordance={
                    <DriveWarningBadge show={drive.partialErrored}>
                        <FolderOpen size={13} />
                    </DriveWarningBadge>
                }
            >
                {/* The count survives a session switch (React Query keeps the swapped mount's
                    last-known value while it revalidates), so a spinner signals the shown count is
                    being refreshed — without it, a switch looks frozen on the previous number. */}
                {drive.isFetching ? (
                    <CircleNotch size={11} className="animate-spin" aria-label="Refreshing" />
                ) : null}
                {label}
            </ConfigRowTrailing>
        </button>
    )
}
