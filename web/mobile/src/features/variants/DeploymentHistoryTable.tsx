import type {ReactNode} from "react"

import type {AppDeploymentRow} from "@agenta/entities/environment"
import {UserAuthorLabel} from "@agenta/entities/shared"
import {FormattedDate} from "@agenta/ui/components/presentational"
import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"

import {DeploymentRowMenu} from "./DeploymentRowMenu"

const REVISION: ListTableColumn = {key: "revision", label: "Revision", width: "72px"}
const VARIANT: ListTableColumn = {key: "variant", label: "Variant", width: "minmax(120px,2fr)"}
const DATE = (width: string): ListTableColumn => ({key: "date", label: "Date modified", width})
const ACTIONS: ListTableColumn = {key: "actions", label: "Actions", srOnly: true, width: "24px"}

const WIDE_COLUMNS: ListTableColumn[] = [
    REVISION,
    VARIANT,
    {key: "notes", label: "Notes", width: "minmax(120px,2fr)"},
    DATE("170px"),
    {key: "by", label: "Modified by", width: "minmax(100px,1fr)"},
    ACTIONS,
]
const NARROW_COLUMNS: ListTableColumn[] = [REVISION, VARIANT, DATE("104px"), ACTIONS]
const WIDE_QUERY = "(min-width: 640px)"

/** The variant's name as the history shows it: the app's slug prefix is dropped. */
export const variantLabel = (row: AppDeploymentRow): string => {
    const slug = row.variantSlug
    if (!slug) return "—"
    return row.appSlug && slug.startsWith(`${row.appSlug}.`)
        ? slug.slice(row.appSlug.length + 1)
        : slug
}

/** The deployments of one app in one environment, newest first. */
export const DeploymentHistoryTable = ({
    rows,
    isLoading,
    currentRevisionId,
    canRevert,
    onOpen,
    onRevert,
    empty,
}: {
    rows: AppDeploymentRow[]
    isLoading: boolean
    currentRevisionId: string | null
    canRevert: boolean
    onOpen: (row: AppDeploymentRow) => void
    onRevert: (row: AppDeploymentRow) => void
    empty: ReactNode
}) => {
    const narrow = !useMediaQuery(WIDE_QUERY)
    return (
        <ListTable
            columns={narrow ? NARROW_COLUMNS : WIDE_COLUMNS}
            minWidth={narrow ? 300 : 760}
            stickyHeader
            loading={isLoading}
            groups={rows.length ? [{key: "all", label: null, rows}] : []}
            rowKey={(row) => row.envRevisionId}
            onOpenRow={onOpen}
            empty={empty}
            renderRow={(row) => (
                <>
                    <span className="block truncate text-[13px] text-muted-foreground">
                        v{row.index}
                    </span>
                    <span className="block min-w-0 truncate text-[14px] font-medium text-foreground">
                        {variantLabel(row)}
                        {row.deployedRevisionVersion != null
                            ? ` v${row.deployedRevisionVersion}`
                            : ""}
                    </span>
                    {narrow ? null : (
                        <span
                            className="block truncate text-[13px] text-muted-foreground"
                            title={row.message ?? undefined}
                        >
                            {row.message || "—"}
                        </span>
                    )}
                    <span className="block truncate text-[13px] text-muted-foreground">
                        <FormattedDate
                            date={row.createdAt}
                            format={narrow ? "MMM D, YYYY" : "MMM D, YYYY h:mm A"}
                            fallback="—"
                        />
                    </span>
                    {narrow ? null : (
                        <span className="block truncate text-[13px] text-muted-foreground">
                            <UserAuthorLabel userId={row.authorId} showYouLabel fallback="—" />
                        </span>
                    )}
                    <span
                        className="flex justify-end"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                    >
                        <DeploymentRowMenu
                            canRevert={
                                canRevert &&
                                row.deployedRevisionId !== null &&
                                row.deployedRevisionId !== currentRevisionId
                            }
                            onOpen={() => onOpen(row)}
                            onRevert={() => onRevert(row)}
                        />
                    </span>
                </>
            )}
        />
    )
}
