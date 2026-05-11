/**
 * SyncStateTag Component
 *
 * Presentational tag for displaying the sync state of a testcase row.
 * No entity dependencies — pure UI component.
 *
 * States:
 * - "modified": Row has local edits not yet synced to the connected testset (blue)
 * - "new": Row was added locally and is not yet in the connected testset (green)
 * - "hidden": Row is hidden from the UI (not shown on the row itself)
 * - "unmodified": No changes — no tag rendered
 *
 * The "modified" state supports an optional dismiss (×) icon for discarding changes.
 */

import {X} from "@phosphor-icons/react"
import {Tag, Tooltip} from "antd"
import clsx from "clsx"

// ============================================================================
// TYPES
// ============================================================================

export type SyncState = "unmodified" | "modified" | "new" | "hidden"

export interface SyncStateTagProps {
    syncState: SyncState
    /**
     * When true, shows a close (×) icon on hover for discarding changes.
     * Only relevant for the "modified" state.
     */
    dismissible?: boolean
    /** Callback invoked when the close icon is clicked. */
    onDismiss?: () => void
    className?: string
}

// ============================================================================
// CONSTANTS
// ============================================================================

const STATE_CONFIG = {
    modified: {
        label: "Edited",
        color: "blue",
    },
    new: {
        label: "New",
        color: "green",
    },
} as const

// ============================================================================
// COMPONENT
// ============================================================================

export function SyncStateTag({syncState, dismissible, onDismiss, className}: SyncStateTagProps) {
    // "unmodified" and "hidden" render nothing on the row
    if (syncState === "unmodified" || syncState === "hidden") {
        return null
    }

    const config = STATE_CONFIG[syncState]
    if (!config) return null

    const showDismiss = dismissible && syncState === "modified" && onDismiss

    return (
        <Tag
            color={config.color}
            className={clsx(
                "!m-0 text-xs leading-none select-none",
                "flex items-center",
                "py-1 px-2",
                showDismiss && "group cursor-pointer",
                className,
            )}
            closeIcon={
                showDismiss ? (
                    <Tooltip title="Discard changes" mouseEnterDelay={0.5}>
                        <X size={12} className="ml-1" />
                    </Tooltip>
                ) : undefined
            }
            onClose={showDismiss ? onDismiss : undefined}
        >
            {config.label}
        </Tag>
    )
}

export default SyncStateTag
