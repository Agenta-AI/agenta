/**
 * The drawer's footer: the revert button and the revert's progress and outcome. The confirmation
 * itself is `RevertConfirmDialog`, scoped to the drawer.
 */

import {cn, textColors} from "@agenta/ui/styles"
import {Button, Spinner} from "@agenta/ui/ui"
import {CheckCircle} from "@phosphor-icons/react"

/** The footer's machine. `done`/`failed` are terminal until the user acts again. */
export type RevertPhase = "idle" | "confirm" | "reverting" | "done" | "failed"

export interface RevertFooterProps {
    phase: RevertPhase
    /** The selected version's number. Null = nothing selected. */
    selectedVersion: number | null
    /** The latest version — the drawer's baseline, and what the confirm copy counts from. */
    latestVersion: number | null
    /** Revert is pointless when the selection is already the current configuration. */
    disabled: boolean
    onRequestConfirm: () => void
    onCancel: () => void
    onConfirm: () => void
    onClose: () => void
    /** Present when the selected version is newer than this view's: switch to it. */
    onUpdate?: () => void
}

export const RevertFooter = ({
    phase,
    selectedVersion,
    latestVersion,
    disabled,
    onRequestConfirm,
    onCancel,
    onConfirm,
    onClose,
    onUpdate,
}: RevertFooterProps) => {
    if (phase === "reverting") {
        return (
            <div className={cn("flex items-center gap-2 text-xs", textColors.secondary)}>
                <Spinner className="size-3.5" />
                Creating v{(latestVersion ?? 0) + 1} from v{selectedVersion}…
            </div>
        )
    }

    if (phase === "done") {
        return (
            <div className="flex items-center gap-2 text-xs text-[var(--ag-colorSuccess)]">
                <CheckCircle size={14} />
                Reverted. The latest version now holds v{selectedVersion}&apos;s configuration.
            </div>
        )
    }

    if (phase === "failed") {
        return (
            <div className="flex items-center justify-between gap-4">
                <span className="text-[11.5px] leading-snug text-[var(--ag-colorError)]">
                    <strong className="font-semibold">Revert failed.</strong> Wait for any save to
                    finish, then try again.
                </span>
                <span className="flex shrink-0 gap-2">
                    <Button variant="outline" onClick={onCancel}>
                        Dismiss
                    </Button>
                    <Button onClick={onConfirm}>Try again</Button>
                </span>
            </div>
        )
    }

    return (
        <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
                Cancel
            </Button>
            {onUpdate ? <Button onClick={onUpdate}>Update to v{selectedVersion}</Button> : null}
            <Button disabled={disabled} onClick={onRequestConfirm}>
                {selectedVersion === null ? "Revert" : `Revert to v${selectedVersion}`}
            </Button>
        </div>
    )
}
