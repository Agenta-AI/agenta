/**
 * DriveExplorerStates — the explorer body's two terminal states: the total failure (with its retry)
 * and the empty drive. Split out so DriveExplorer's body branch reads as a three-line switch;
 * the loading state is {@link DriveExplorerSkeleton}.
 */
import {type DriveScope} from "@agenta/entities/drive"
import {type SessionDriveData} from "@agenta/entities/drive"
import {
    Button,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@agenta/ui/ui"
import {ArrowClockwise, CircleNotch, Tray, WarningCircle} from "@phosphor-icons/react"

export function DriveErrorState({drive}: {drive: SessionDriveData}) {
    return (
        <Empty className="flex-1 gap-2 p-8">
            <EmptyHeader className="gap-1">
                <EmptyMedia variant="icon">
                    <WarningCircle size={26} />
                </EmptyMedia>
                <EmptyTitle className="text-xs">Couldn&apos;t reach the file store</EmptyTitle>
                <EmptyDescription className="text-xs">
                    This deployment may have no file store configured.
                </EmptyDescription>
            </EmptyHeader>
            {drive.retry ? (
                <EmptyContent>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={drive.retry}
                        disabled={drive.isFetching}
                        aria-busy={drive.isFetching || undefined}
                    >
                        {drive.isFetching ? (
                            <CircleNotch className="animate-spin" />
                        ) : (
                            <ArrowClockwise />
                        )}
                        {drive.isFetching ? "Loading…" : "Try again"}
                    </Button>
                </EmptyContent>
            ) : null}
        </Empty>
    )
}

export function DriveEmptyState({scope}: {scope: DriveScope}) {
    return (
        <Empty className="flex-1 gap-2 p-8">
            <EmptyHeader className="gap-1">
                <EmptyMedia variant="icon">
                    <Tray size={26} />
                </EmptyMedia>
                <EmptyTitle className="text-xs">This drive is empty</EmptyTitle>
                <EmptyDescription className="text-xs">
                    {scope === "session"
                        ? "Created on the conversation's first run."
                        : "Files the agent keeps across conversations land here."}
                </EmptyDescription>
            </EmptyHeader>
        </Empty>
    )
}
