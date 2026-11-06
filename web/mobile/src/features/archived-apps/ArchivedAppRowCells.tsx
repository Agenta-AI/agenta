import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {workflowAppTypeAtomFamily} from "@agenta/entities/workflow"
import {WorkflowTypeTag} from "@agenta/entity-ui/workflow"
import {formatListDateTime} from "@agenta/ui/list-table"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {ArrowCounterClockwise, DotsThreeVertical} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {AppTypeIcon} from "@/components/AppTypeIcon"

import {formatDay, type ArchivedAppRow} from "./archivedAppsView"
import {useRestoreArchivedApp} from "./useRestoreArchivedApp"

/**
 * One archived app's cells, in column order. A component rather than a closure in `renderRow`
 * because the row holds the restore guard.
 */
export const ArchivedAppRowCells = ({
    row,
    projectId,
    narrow,
    canRestore,
}: {
    row: ArchivedAppRow
    projectId: string
    /** A phone shows the name and the archive date only. */
    narrow: boolean
    /** Restoring needs `edit_workflows`; without it the row has no menu. */
    canRestore: boolean
}) => {
    const appType = useAtomValue(workflowAppTypeAtomFamily(row.id))
    const {restore, restoring} = useRestoreArchivedApp(projectId)

    return (
        <>
            <span className="flex min-w-0 items-center gap-2">
                <AppTypeIcon appType={appType} />
                <span
                    className="truncate text-[14px] font-medium leading-[18px] text-foreground"
                    title={row.name}
                >
                    {row.name}
                </span>
            </span>

            {narrow ? null : (
                <span className="block truncate text-[13px] text-muted-foreground">
                    {formatListDateTime(row.createdAt)}
                </span>
            )}
            {narrow ? null : (
                <span className="flex min-w-0">
                    <WorkflowTypeTag isEvaluator={false} workflowType={appType} />
                </span>
            )}

            <span className="block truncate text-[13px] text-muted-foreground">
                {/* A phone has 96px for the date, so it keeps the day without the time. */}
                {narrow ? formatDay(row.archivedAt) : formatListDateTime(row.archivedAt)}
            </span>
            {narrow ? null : (
                <span className="block min-w-0 truncate text-[13px] text-muted-foreground">
                    <UserAuthorLabel
                        userId={row.archivedById}
                        showYouLabel
                        showAvatar
                        fallback="—"
                    />
                </span>
            )}

            <span className="flex justify-end">
                {canRestore ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                aria-label="App actions"
                                className="relative flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-colorTextSecondary after:absolute after:-inset-1.5 after:content-[''] hover:bg-colorFillTertiary hover:text-colorText"
                            >
                                <DotsThreeVertical size={16} weight="bold" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-max min-w-[160px]">
                            <DropdownMenuItem
                                disabled={restoring}
                                onSelect={() => void restore(row.id)}
                            >
                                <ArrowCounterClockwise size={16} />
                                Restore
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : null}
            </span>
        </>
    )
}
