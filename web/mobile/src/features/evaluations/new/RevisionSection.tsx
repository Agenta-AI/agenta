import {useMemo, useState} from "react"

import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {workflowLatestRevisionIdAtomFamily} from "@agenta/entities/workflow"
import {VariantDetailsWithStatus} from "@agenta/entity-ui/variant"
import {FormattedDate, LoadError} from "@agenta/ui/components/presentational"
import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {RadioGroup} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {useAppRevisions, type AppRevisionRow} from "../../variants/useAppRevisions"

import {ExpandToggle} from "./ExpandToggle"
import {LoadMoreButton} from "./LoadMoreButton"
import type {DraftRevision, NewEvaluationKind} from "./newEvaluationDraft"
import {PickCell} from "./PickCell"
import {SectionHint} from "./SectionHint"
import {StepSearch} from "./StepSearch"
import {flattenTree, toggleKey, type TreeRow} from "./treeRows"

const PICK: ListTableColumn = {key: "pick", label: "Select", srOnly: true, width: "20px"}
const NAME: ListTableColumn = {key: "name", label: "Name", width: "minmax(200px,2fr)"}
const CREATED_ON: ListTableColumn = {key: "createdOn", label: "Created on", width: "110px"}
const WIDE_COLUMNS = [
    PICK,
    NAME,
    {key: "model", label: "Model", width: "minmax(120px,1fr)"},
    CREATED_ON,
    {key: "createdBy", label: "Created by", width: "minmax(110px,1fr)"},
    {key: "notes", label: "Commit notes", width: "minmax(120px,1.5fr)"},
]
const NARROW_COLUMNS = [PICK, {...NAME, width: "minmax(150px,2fr)"}, CREATED_ON]

/** Tailwind's `sm`. Below it the table keeps the name and the date. */
const WIDE_QUERY = "(min-width: 640px)"

const NONE: ReadonlySet<string> = new Set()

const toDraftRevision = (row: AppRevisionRow): DraftRevision => ({
    id: row.revisionId,
    variantName: row.variantName,
    version: row.version,
})

/**
 * Pick the revisions to evaluate: one row per variant with its newest revision, its version,
 * deployments, model, date, author and commit notes, and its older revisions under it. An auto
 * evaluation takes several revisions, a human evaluation one. The caller keys it on the app, so
 * a new app starts with a fresh search and nothing expanded.
 */
export const RevisionSection = ({
    kind,
    projectId,
    appId,
    selected,
    disabled,
    onPick,
}: {
    kind: NewEvaluationKind
    projectId: string
    appId: string
    selected: readonly DraftRevision[]
    disabled?: boolean
    onPick: (revision: DraftRevision) => void
}) => {
    const narrow = !useMediaQuery(WIDE_QUERY)
    const [search, setSearch] = useState("")
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(NONE)
    const {rows, isPending, isError, hasMore, isLoadingMore, loadMore, refetch} = useAppRevisions({
        projectId,
        appId,
        search,
    })
    const latestRevisionId = useAtomValue(workflowLatestRevisionIdAtomFamily(appId)) ?? null
    const selectedIds = useMemo(() => new Set(selected.map((revision) => revision.id)), [selected])
    const tree = useMemo(
        () => flattenTree(rows, (row) => row.variantId || row.variantName, expanded),
        [rows, expanded],
    )
    const groups = useMemo(() => [{key: "all", label: null, rows: tree}], [tree])
    const single = kind === "human"

    if (isError) {
        return <LoadError title="Could not load revisions" onRetry={() => void refetch()} />
    }

    const pick = (row: AppRevisionRow) => {
        if (!disabled) onPick(toDraftRevision(row))
    }
    const pickById = (id: string) => {
        const row = rows.find((item) => item.revisionId === id)
        if (row) pick(row)
    }

    const renderRow = ({row, groupKey, depth, olderCount}: TreeRow<AppRevisionRow>) => (
        <>
            <PickCell
                mode={single ? "single" : "multiple"}
                value={row.revisionId}
                checked={selectedIds.has(row.revisionId)}
                label={`Select ${row.variantName} v${row.version}`}
                disabled={disabled}
                onToggle={() => pick(row)}
            />
            <span className="flex min-w-0 items-center gap-2" style={{paddingLeft: depth * 20}}>
                {depth === 0 ? (
                    <ExpandToggle
                        count={olderCount}
                        expanded={expanded.has(groupKey)}
                        label={`Show older revisions of ${row.variantName}`}
                        onToggle={() => setExpanded((current) => toggleKey(current, groupKey))}
                    />
                ) : null}
                <span className="block min-w-0 truncate text-[14px] font-medium text-foreground">
                    <VariantDetailsWithStatus
                        variant={{id: row.revisionId}}
                        variantName={row.variantName}
                        revision={row.version}
                        isLatest={row.revisionId === latestRevisionId && !narrow}
                        showBadges
                        showRevisionAsTag
                        hideDiscard
                        showStable
                    />
                </span>
            </span>
            {narrow ? null : (
                <span className="block truncate text-[13px] text-muted-foreground">
                    {row.model || "—"}
                </span>
            )}
            <span className="block truncate text-[13px] text-muted-foreground">
                <FormattedDate date={row.createdAt} format="MMM D, YYYY" fallback="—" />
            </span>
            {narrow ? null : (
                <span className="block truncate text-[13px] text-muted-foreground">
                    <UserAuthorLabel userId={row.createdById} showYouLabel fallback="—" />
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
        </>
    )

    const table = (
        <ListTable
            columns={narrow ? NARROW_COLUMNS : WIDE_COLUMNS}
            minWidth={narrow ? 300 : 820}
            loading={isPending}
            groups={groups}
            rowKey={({row}) => row.revisionId}
            onOpenRow={disabled ? undefined : ({row}) => pick(row)}
            empty={<SectionHint>No available revisions found to display</SectionHint>}
            renderRow={renderRow}
        />
    )

    return (
        <div className="flex flex-col gap-3">
            <StepSearch
                value={search}
                label="Search revisions"
                disabled={disabled}
                onChange={setSearch}
            />
            {single ? (
                <RadioGroup
                    value={selected[0]?.id ?? ""}
                    onValueChange={pickById}
                    disabled={disabled}
                    aria-label="Revisions"
                    className="block"
                >
                    {table}
                </RadioGroup>
            ) : (
                <div role="group" aria-label="Revisions">
                    {table}
                </div>
            )}
            {hasMore ? (
                <LoadMoreButton loading={isLoadingMore} onLoadMore={() => void loadMore()} />
            ) : null}
        </div>
    )
}
