import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {formatListDateTime} from "@agenta/ui/list-table"
import {Button, CollapseCaret, Spinner} from "@agenta/ui/ui"

import {formatTestsetDate} from "./formatTestsetDate"
import {TestsetRowMenu} from "./TestsetRowMenu"
import type {TestsetRow, TestsetRowActions} from "./testsetRowTypes"

/**
 * One testset's cells, in column order. A phone has only the Name and Date Created cells.
 *
 * In developer mode the cells follow the classic app: Date Created (with the time) before
 * Created by. Outside it the list keeps its earlier order and short date.
 */
export const TestsetRowCells = ({
    row,
    commitMessage,
    narrow,
    developerMode,
    busy,
    canEdit,
    canExport,
    exportDisabled,
    actions,
    expanded = false,
    onToggleExpand,
}: {
    row: TestsetRow
    /** The latest message a person wrote, or null. */
    commitMessage: string | null
    narrow: boolean
    developerMode: boolean
    /** The row is opening or exporting. */
    busy: boolean
    canEdit: boolean
    canExport: boolean
    exportDisabled: boolean
    actions: TestsetRowActions
    expanded?: boolean
    /** Absent hides the revisions toggle (developer mode only). */
    onToggleExpand?: () => void
}) => {
    const author = (
        <span className="block min-w-0 truncate text-[13px] text-muted-foreground">
            <UserAuthorLabel userId={row.created_by_id} showAvatar fallback="—" />
        </span>
    )
    return (
        <>
            <span className="flex min-w-0 items-center gap-1">
                {onToggleExpand ? (
                    // The toggle's own clicks are not the row's: the row opens the test set.
                    <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`${expanded ? "Hide" : "Show"} revisions of ${row.name}`}
                        aria-expanded={expanded}
                        className="-ml-1 shrink-0"
                        onClick={(event) => {
                            event.stopPropagation()
                            onToggleExpand()
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                    >
                        <CollapseCaret open={expanded} />
                    </Button>
                ) : null}
                <span
                    className="block truncate text-[14px] font-medium leading-[18px] text-foreground"
                    title={row.name}
                >
                    {row.name}
                </span>
            </span>
            {narrow ? null : (
                <span
                    className={`block truncate text-[13px] ${
                        commitMessage ? "text-muted-foreground" : "text-placeholder"
                    }`}
                    title={commitMessage ?? undefined}
                >
                    {commitMessage ?? "—"}
                </span>
            )}
            {narrow || developerMode ? null : author}
            <span className="block truncate text-[13px] text-placeholder">
                {developerMode
                    ? formatListDateTime(row.created_at)
                    : formatTestsetDate(row.created_at)}
            </span>
            {!narrow && developerMode ? author : null}
            {/* The menu's own clicks are not the row's: without this every menu press would also
            open the testset. */}
            <span
                className="flex justify-end"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
            >
                {busy ? (
                    <Spinner aria-label="Working" />
                ) : (
                    <TestsetRowMenu
                        actions={actions}
                        canEdit={canEdit}
                        canExport={canExport}
                        exportDisabled={exportDisabled}
                    />
                )}
            </span>
        </>
    )
}
