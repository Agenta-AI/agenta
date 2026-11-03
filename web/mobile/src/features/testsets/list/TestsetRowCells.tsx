import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {Spinner} from "@agenta/ui/ui"

import {formatTestsetDate} from "./formatTestsetDate"
import {TestsetRowMenu} from "./TestsetRowMenu"
import type {TestsetRow, TestsetRowActions} from "./testsetRowTypes"

/** One testset's cells, in column order. A phone has only the Name and Date Created cells. */
export const TestsetRowCells = ({
    row,
    commitMessage,
    narrow,
    busy,
    canEdit,
    canExport,
    exportDisabled,
    actions,
}: {
    row: TestsetRow
    /** The latest message a person wrote, or null. */
    commitMessage: string | null
    narrow: boolean
    /** The row is opening or exporting. */
    busy: boolean
    canEdit: boolean
    canExport: boolean
    exportDisabled: boolean
    actions: TestsetRowActions
}) => (
    <>
        <span
            className="block truncate text-[14px] font-medium leading-[18px] text-foreground"
            title={row.name}
        >
            {row.name}
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
        {narrow ? null : (
            <span className="block min-w-0 truncate text-[13px] text-muted-foreground">
                <UserAuthorLabel userId={row.created_by_id} showAvatar fallback="—" />
            </span>
        )}
        <span className="block truncate text-[13px] text-placeholder">
            {formatTestsetDate(row.created_at)}
        </span>
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
