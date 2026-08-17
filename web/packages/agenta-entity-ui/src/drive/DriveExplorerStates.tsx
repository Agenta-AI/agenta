/**
 * DriveExplorerStates — the explorer body's two terminal states: the total failure (with its retry)
 * and the empty drive. Split out so DriveExplorer's body branch reads as a three-line switch;
 * the loading state is {@link DriveExplorerSkeleton}.
 */
import {type DriveScope} from "@agenta/entities/drive"
import {type SessionDriveData} from "@agenta/entities/drive"
import {Alert} from "@agenta/ui/ui"
import {Tray, WarningCircle} from "@phosphor-icons/react"

import {DriveRetryButton} from "./DriveFileRow"

// Same centred icon + two lines as the empty state — the sibling terminal state in this slot; only
// the glyph carries the warning tone, so a failed drive doesn't shout a full alert box at the user.
export function DriveErrorState({drive}: {drive: SessionDriveData}) {
    return (
        <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
            <WarningCircle size={20} weight="fill" className="text-colorWarning" />
            <div className="text-xs font-medium">Couldn&apos;t load this drive</div>
            <div className="text-xs text-colorTextTertiary">
                The file store may not be configured on this deployment.
            </div>
            {drive.retry ? (
                <div className="mt-1">
                    <DriveRetryButton onRetry={drive.retry} busy={drive.isFetching} />
                </div>
            ) : null}
        </div>
    )
}

export function DriveEmptyState({scope}: {scope: DriveScope}) {
    return (
        <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
            <Tray size={28} className="text-colorTextQuaternary" />
            <div className="text-xs font-medium">This drive is empty</div>
            <div className="text-xs text-colorTextTertiary">
                {scope === "session"
                    ? "Created on the conversation's first run."
                    : "Files the agent keeps across conversations land here."}
            </div>
        </div>
    )
}
