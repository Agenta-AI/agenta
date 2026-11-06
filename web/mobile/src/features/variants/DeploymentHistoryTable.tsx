import type {ReactNode} from "react"

import type {AppDeploymentRow} from "@agenta/entities/environment"
import {UserAuthorLabel} from "@agenta/entities/shared"
import {VariantDetailsWithStatus} from "@agenta/entity-ui/variant"
import {FormattedDate} from "@agenta/ui/components/presentational"
import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn, type ListTableSelection} from "@agenta/ui/list-table"

import {DeploymentRowMenu, type DeploymentRowExtras} from "./DeploymentRowMenu"
import {variantLabel} from "./deploymentVariantLabel"

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

/**
 * What beta developer mode adds, as /w has it: row selection, the variant as a name and version
 * tag, avatars, and the longer row menu.
 */
export interface DeploymentHistoryDeveloper {
    selection: ListTableSelection<AppDeploymentRow>
    rowExtras: (row: AppDeploymentRow) => Omit<DeploymentRowExtras, "revertReason">
}

const revertReason = (
    row: AppDeploymentRow,
    canRevert: boolean,
    currentRevisionId: string | null,
): string | null => {
    if (!canRevert) return "You don't have permission to deploy"
    if (row.deployedRevisionId === null) return "This row has no revision"
    if (row.deployedRevisionId === currentRevisionId) return "Already live in this environment"
    return null
}

/** The deployments of one app in one environment, newest first. */
export const DeploymentHistoryTable = ({
    rows,
    isLoading,
    variantNames,
    authorNames,
    currentRevisionId,
    canRevert,
    onOpen,
    onRevert,
    empty,
    developer,
}: {
    rows: AppDeploymentRow[]
    isLoading: boolean
    /** Current variant names by id: a renamed variant shows its new name. */
    variantNames: ReadonlyMap<string, string>
    /** Member display names by user id, for the Modified by column. */
    authorNames: ReadonlyMap<string, string>
    currentRevisionId: string | null
    canRevert: boolean
    onOpen: (row: AppDeploymentRow) => void
    onRevert: (row: AppDeploymentRow) => void
    empty: ReactNode
    /** Beta developer mode only. */
    developer?: DeploymentHistoryDeveloper
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
            selection={developer?.selection}
            renderRow={(row) => (
                <>
                    <span className="block truncate text-[13px] text-muted-foreground">
                        v{row.index}
                    </span>
                    {developer ? (
                        <span className="block min-w-0 truncate text-[14px]">
                            <VariantDetailsWithStatus
                                className="min-w-0 justify-start"
                                variantName={variantLabel(row, variantNames)}
                                revision={row.deployedRevisionVersion}
                                showRevisionAsTag
                                hideDiscard
                                showLatestTag={false}
                            />
                        </span>
                    ) : (
                        <span className="block min-w-0 truncate text-[14px] font-medium text-foreground">
                            {variantLabel(row, variantNames)}
                            {row.deployedRevisionVersion != null
                                ? ` v${row.deployedRevisionVersion}`
                                : ""}
                        </span>
                    )}
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
                            <UserAuthorLabel
                                userId={row.authorId}
                                name={row.authorId ? authorNames.get(row.authorId) : null}
                                showYouLabel
                                showAvatar={Boolean(developer)}
                                fallback="—"
                            />
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
                            extras={
                                developer
                                    ? {
                                          ...developer.rowExtras(row),
                                          revertReason: revertReason(
                                              row,
                                              canRevert,
                                              currentRevisionId,
                                          ),
                                      }
                                    : undefined
                            }
                        />
                    </span>
                </>
            )}
        />
    )
}
