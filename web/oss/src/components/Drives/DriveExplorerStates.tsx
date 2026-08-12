/**
 * DriveExplorerStates — the explorer body's two terminal states: the total-failure banner (with its
 * retry) and the empty drive. Split out so DriveExplorer's body branch reads as a three-line switch;
 * the loading state is {@link DriveExplorerSkeleton}.
 */
import {Tray} from "@phosphor-icons/react"
import {Alert} from "antd"

import {DriveRetryButton} from "./DriveFileRow"
import {type DriveScope} from "./driveTypes"
import {type SessionDriveData} from "./useSessionDrive"

export function DriveErrorState({drive}: {drive: SessionDriveData}) {
    return (
        <div className="w-full p-4">
            <Alert
                type="warning"
                showIcon
                message="Couldn't load this drive"
                description={
                    <span className="text-xs">
                        The file store may not be configured on this deployment.
                        {drive.retry ? (
                            <>
                                {" "}
                                <DriveRetryButton onRetry={drive.retry} busy={drive.isFetching} />
                            </>
                        ) : null}
                    </span>
                }
            />
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
