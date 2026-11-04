import {UserAuthorLabel} from "@agenta/entities/shared/user"
import type {Testset} from "@agenta/entities/testset"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    Spinner,
} from "@agenta/ui/ui"
import {ArrowCounterClockwise, DotsThreeVertical, Eye} from "@phosphor-icons/react"

import {formatTestsetDate} from "../list/formatTestsetDate"

import {useRestoreTestset} from "./useRestoreTestset"

/** An archived test set's row, with the two fields only an archived row has. */
export type ArchivedTestsetRow = Pick<
    Testset,
    "id" | "name" | "created_at" | "created_by_id" | "deleted_at" | "deleted_by_id"
>

/**
 * One archived test set's cells, in column order. A component rather than a closure in
 * `renderRow` because the row holds the restore guard.
 */
export const ArchivedTestsetRowCells = ({
    row,
    projectId,
    narrow,
    busy,
    canRestore,
    onOpen,
}: {
    row: ArchivedTestsetRow
    projectId: string
    /** A phone shows the name and the archive date only. */
    narrow: boolean
    /** The row is opening its latest revision. */
    busy: boolean
    /** Restoring needs `edit_testsets`; without it the menu keeps View details only. */
    canRestore: boolean
    onOpen: () => void
}) => {
    const {restore, restoring} = useRestoreTestset(projectId)

    return (
        <>
            <span
                className="block truncate text-[14px] font-medium leading-[18px] text-foreground"
                title={row.name}
            >
                {row.name}
            </span>
            {narrow ? null : (
                <span className="block truncate text-[13px] text-placeholder">
                    {formatTestsetDate(row.created_at)}
                </span>
            )}
            {narrow ? null : (
                <span className="block min-w-0 truncate text-[13px] text-muted-foreground">
                    <UserAuthorLabel userId={row.created_by_id} showAvatar fallback="—" />
                </span>
            )}
            <span className="block truncate text-[13px] text-placeholder">
                {formatTestsetDate(row.deleted_at)}
            </span>
            {narrow ? null : (
                <span className="block min-w-0 truncate text-[13px] text-muted-foreground">
                    <UserAuthorLabel
                        userId={row.deleted_by_id}
                        showYouLabel
                        showAvatar
                        fallback="—"
                    />
                </span>
            )}
            {/* The menu's own clicks are not the row's: without this every menu press would also
                open the test set. */}
            <span
                className="flex justify-end"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
            >
                {busy ? (
                    <Spinner aria-label="Working" />
                ) : (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                aria-label="Test set actions"
                                className="hover:bg-foreground/10 dark:hover:bg-foreground/15"
                            >
                                <DotsThreeVertical aria-hidden className="size-3.5" weight="bold" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-[200px]">
                            <DropdownMenuItem onSelect={onOpen}>
                                <Eye aria-hidden size={14} />
                                View details
                            </DropdownMenuItem>
                            {canRestore ? (
                                <DropdownMenuItem
                                    disabled={restoring}
                                    onSelect={() => void restore(row.id)}
                                >
                                    <ArrowCounterClockwise aria-hidden size={14} />
                                    Restore
                                </DropdownMenuItem>
                            ) : null}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </span>
        </>
    )
}
