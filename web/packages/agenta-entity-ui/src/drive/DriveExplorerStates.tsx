/**
 * DriveExplorerStates — the explorer body's two terminal states: the total failure (with its retry)
 * and the empty drive. Split out so DriveExplorer's body branch reads as a three-line switch;
 * the loading state is {@link DriveExplorerSkeleton}.
 */
import {type DriveScope} from "@agenta/entities/drive"
import {type SessionDriveData} from "@agenta/entities/drive"
import {useT} from "@agenta/i18n"
import driveExplorerCatalog from "@agenta/i18n/catalogs/entityUi.driveExplorer"
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
    const t = useT(driveExplorerCatalog)
    return (
        <Empty className="flex-1 gap-2 p-8">
            <EmptyHeader className="gap-1">
                <EmptyMedia variant="icon">
                    <WarningCircle size={26} />
                </EmptyMedia>
                <EmptyTitle className="text-xs">
                    {t("entityUi.driveExplorer.couldNotReachStore")}
                </EmptyTitle>
                <EmptyDescription className="text-xs">
                    {t("entityUi.driveExplorer.noStoreConfigured")}
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
                        {drive.isFetching
                            ? t("entityUi.driveExplorer.loading")
                            : t("entityUi.driveExplorer.tryAgain")}
                    </Button>
                </EmptyContent>
            ) : null}
        </Empty>
    )
}

export function DriveEmptyState({scope}: {scope: DriveScope}) {
    const t = useT(driveExplorerCatalog)
    return (
        <Empty className="flex-1 gap-2 p-8">
            <EmptyHeader className="gap-1">
                <EmptyMedia variant="icon">
                    <Tray size={26} />
                </EmptyMedia>
                <EmptyTitle className="text-xs">{t("entityUi.driveExplorer.driveEmpty")}</EmptyTitle>
                <EmptyDescription className="text-xs">
                    {scope === "session"
                        ? t("entityUi.driveExplorer.createdOnFirstRun")
                        : t("entityUi.driveExplorer.agentFilesLandHere")}
                </EmptyDescription>
            </EmptyHeader>
        </Empty>
    )
}
