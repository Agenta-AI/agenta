import {useMemo, useState} from "react"

import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {FormattedDate, LoadError} from "@agenta/ui/components/presentational"
import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"

import {visibleCommitMessage} from "../../testsets/list/commitMessage"
import type {TestsetRow} from "../../testsets/list/testsetRowTypes"
import {useTestsetsList} from "../../testsets/list/useTestsetsList"

import {ExpectedVariables} from "./ExpectedVariables"
import {LoadMoreButton} from "./LoadMoreButton"
import type {DraftRevision, DraftTestset} from "./newEvaluationDraft"
import {PickCell} from "./PickCell"
import {SectionHint} from "./SectionHint"
import {StepSearch} from "./StepSearch"
import {useTestsetLatestRevisions} from "./useTestsetLatestRevisions"

const PICK: ListTableColumn = {key: "pick", label: "Select", srOnly: true, width: "20px"}
const NAME: ListTableColumn = {key: "name", label: "Name", width: "minmax(160px,2fr)"}
const CREATED: ListTableColumn = {key: "created", label: "Date Created", width: "minmax(150px,1fr)"}
const WIDE_COLUMNS = [
    PICK,
    NAME,
    {key: "commit", label: "Commit Message", width: "minmax(140px,2fr)"},
    CREATED,
    {key: "author", label: "Created by", width: "minmax(120px,1fr)"},
]
const NARROW_COLUMNS = [PICK, {...NAME, width: "minmax(120px,2fr)"}, {...CREATED, width: "110px"}]

/** Tailwind's `sm`. Below it the table keeps the name and the date. */
const WIDE_QUERY = "(min-width: 640px)"

/**
 * Pick the test set to run on: the expected input variables, then a table of the project's test
 * sets. A pick takes the test set's latest revision; picking the selected one again clears it.
 */
export const TestsetSection = ({
    projectId,
    revisions,
    selected,
    disabled,
    onPick,
}: {
    projectId: string
    revisions: readonly DraftRevision[]
    selected: DraftTestset | null
    disabled?: boolean
    onPick: (testset: DraftTestset) => void
}) => {
    const narrow = !useMediaQuery(WIDE_QUERY)
    const [search, setSearch] = useState("")
    const {testsets, isPending, isError, refetch, hasMore, loadMore, isLoadingMore} =
        useTestsetsList({projectId, search})
    const latest = useTestsetLatestRevisions({
        projectId,
        testsetIds: useMemo(() => testsets.map((testset) => testset.id), [testsets]),
    })
    const groups = useMemo(() => [{key: "all", label: null, rows: testsets}], [testsets])

    if (isError) {
        return <LoadError title="Could not load test sets" onRetry={refetch} />
    }

    const pick = (row: TestsetRow) => {
        const revision = latest.get(row.id)
        if (disabled || !revision) return
        onPick({
            revisionId: revision.id,
            testsetId: row.id,
            name: row.name,
            version: Number(revision.version ?? 0),
        })
    }

    return (
        <div className="flex flex-col gap-3">
            <ExpectedVariables revisions={revisions} />
            <StepSearch
                value={search}
                label="Search test sets"
                disabled={disabled}
                onChange={setSearch}
            />
            <div role="group" aria-label="Test sets">
                <ListTable
                    columns={narrow ? NARROW_COLUMNS : WIDE_COLUMNS}
                    minWidth={narrow ? 280 : 640}
                    loading={isPending}
                    groups={groups}
                    rowKey={(row) => row.id}
                    onOpenRow={disabled ? undefined : pick}
                    // A pick takes the latest revision, so a row waits for it.
                    canOpenRow={(row) => latest.has(row.id)}
                    empty={<SectionHint>No test sets available</SectionHint>}
                    renderRow={(row) => {
                        const message = visibleCommitMessage(latest.get(row.id)?.message)
                        return (
                            <>
                                <PickCell
                                    mode="multiple"
                                    value={row.id}
                                    checked={selected?.testsetId === row.id}
                                    label={`Select ${row.name}`}
                                    disabled={disabled || !latest.has(row.id)}
                                    onToggle={() => pick(row)}
                                />
                                <span
                                    className="block truncate text-[14px] font-medium text-foreground"
                                    title={row.name}
                                >
                                    {row.name}
                                </span>
                                {narrow ? null : (
                                    <span
                                        className="block truncate text-[13px] text-muted-foreground"
                                        title={message ?? undefined}
                                    >
                                        {message ?? "—"}
                                    </span>
                                )}
                                <span className="block truncate text-[13px] text-muted-foreground">
                                    <FormattedDate
                                        date={row.created_at}
                                        format={narrow ? "MMM D, YYYY" : undefined}
                                        fallback="—"
                                    />
                                </span>
                                {narrow ? null : (
                                    <span className="block min-w-0 truncate text-[13px] text-muted-foreground">
                                        <UserAuthorLabel
                                            userId={row.created_by_id}
                                            showAvatar
                                            fallback="—"
                                        />
                                    </span>
                                )}
                            </>
                        )
                    }}
                />
            </div>
            {hasMore ? <LoadMoreButton loading={isLoadingMore} onLoadMore={loadMore} /> : null}
        </div>
    )
}
