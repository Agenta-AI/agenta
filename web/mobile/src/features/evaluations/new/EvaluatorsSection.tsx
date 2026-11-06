import {useMemo, useState} from "react"

import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {WorkflowTypeTag} from "@agenta/entity-ui/workflow"
import {LoadError} from "@agenta/ui/components/presentational"
import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {PlusIcon} from "@phosphor-icons/react"

import {formatDay} from "../../archived-apps/archivedAppsView"
import {EvaluatorKeyTags} from "../../evaluators/EvaluatorKeyTags"
import type {EvaluatorRevisionRow} from "../../evaluators/evaluatorsView"
import {useEvaluatorRevisions} from "../../evaluators/useEvaluatorRevisions"
import {useEvaluatorEntries} from "../../evaluators/useEvaluators"

import {toEvaluatorRows} from "./evaluatorRows"
import {EvaluatorsEmpty} from "./EvaluatorsEmpty"
import {EvaluatorTemplateTags} from "./EvaluatorTemplateTags"
import {ExpandToggle} from "./ExpandToggle"
import {MutedCell} from "./MutedCell"
import type {DraftEvaluator, NewEvaluationKind} from "./newEvaluationDraft"
import {PickCell} from "./PickCell"
import {SectionHint} from "./SectionHint"
import {StepSearch} from "./StepSearch"
import {flattenTree, toggleKey, type TreeRow} from "./treeRows"

const col = (key: string, label: string, width: string): ListTableColumn => ({key, label, width})

const PICK: ListTableColumn = {key: "pick", label: "Select", srOnly: true, width: "20px"}
const NAME = col("name", "Name", "minmax(180px,2fr)")
const CREATED = col("created", "Date Created", "minmax(110px,1fr)")
const LAST_MODIFIED = col("updated", "Last modified", "minmax(110px,1fr)")
const MODIFIED_BY = col("modifiedBy", "Modified by", "minmax(120px,1fr)")
const TYPE = col("type", "Type", "minmax(120px,1fr)")
const FEEDBACK = col("feedback", "Feedback", "minmax(140px,1.5fr)")

const AUTOMATIC_COLUMNS = [
    PICK,
    NAME,
    TYPE,
    col("tags", "Tags", "minmax(120px,1fr)"),
    CREATED,
    LAST_MODIFIED,
    MODIFIED_BY,
    col("message", "Commit message", "minmax(140px,1.5fr)"),
]
const HUMAN_COLUMNS = [PICK, NAME, FEEDBACK, CREATED, LAST_MODIFIED, MODIFIED_BY]
const NARROW_NAME = col("name", "Name", "minmax(130px,2fr)")

/** Tailwind's `sm`. Below it the table keeps the name and the type, or the feedback. */
const WIDE_QUERY = "(min-width: 640px)"

const NONE: ReadonlySet<string> = new Set()

const toDraftEvaluator = (row: EvaluatorRevisionRow): DraftEvaluator => ({
    revisionId: row.id,
    evaluatorId: row.workflowId,
    name: row.name ?? row.slug ?? "Evaluator",
    version: row.version ?? 0,
})

/**
 * Pick the evaluators that score the run: a table of the project's automatic evaluators (auto
 * run) or human evaluators (human run), each with its older versions under it, and a link to
 * create a new evaluator. The link opens the Evaluators page in a new tab, so the draft stays.
 */
export const EvaluatorsSection = ({
    kind,
    projectId,
    selected,
    disabled,
    evaluatorsHref,
    onPick,
}: {
    kind: NewEvaluationKind
    projectId: string
    selected: readonly DraftEvaluator[]
    disabled?: boolean
    /** The Evaluators page. Null while the evaluators view is off: no link then. */
    evaluatorsHref: string | null
    onPick: (evaluator: DraftEvaluator) => void
}) => {
    const narrow = !useMediaQuery(WIDE_QUERY)
    const category = kind === "human" ? "human" : "automatic"
    const human = category === "human"
    const [search, setSearch] = useState("")
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(NONE)
    const entries = useEvaluatorEntries({mode: "active", projectId, category, search})
    const workflowIds = useMemo(
        () => entries.entries.map((entry) => entry.workflow.id),
        [entries.entries],
    )
    const {revisions} = useEvaluatorRevisions({projectId, workflowIds})
    const tree = useMemo(
        () =>
            flattenTree(
                toEvaluatorRows(entries.entries, revisions),
                (row) => row.workflowId,
                expanded,
            ),
        [entries.entries, revisions, expanded],
    )
    const groups = useMemo(() => [{key: "all", label: null, rows: tree}], [tree])
    const selectedIds = useMemo(() => new Set(selected.map((item) => item.revisionId)), [selected])
    const createHref = evaluatorsHref ? `${evaluatorsHref}?tab=${category}` : null

    if (entries.isError) {
        return (
            <LoadError title="Could not load evaluators" onRetry={() => void entries.refetch()} />
        )
    }
    if (!entries.isPending && entries.entries.length === 0 && !search) {
        return <EvaluatorsEmpty evaluatorsHref={createHref} />
    }

    const pick = (row: EvaluatorRevisionRow) => {
        if (!disabled) onPick(toDraftEvaluator(row))
    }

    const columns = narrow
        ? [PICK, NARROW_NAME, human ? FEEDBACK : TYPE]
        : human
          ? HUMAN_COLUMNS
          : AUTOMATIC_COLUMNS

    const renderRow = ({row, groupKey, depth, olderCount}: TreeRow<EvaluatorRevisionRow>) => {
        const name = row.name ?? row.slug ?? "—"
        return (
            <>
                <PickCell
                    mode="multiple"
                    value={row.id}
                    checked={selectedIds.has(row.id)}
                    label={`Select ${name} v${row.version ?? 0}`}
                    disabled={disabled}
                    onToggle={() => pick(row)}
                />
                <span className="flex min-w-0 items-center gap-2" style={{paddingLeft: depth * 20}}>
                    {depth === 0 ? (
                        <ExpandToggle
                            count={olderCount}
                            expanded={expanded.has(groupKey)}
                            label={`Show older versions of ${name}`}
                            onToggle={() => setExpanded((current) => toggleKey(current, groupKey))}
                        />
                    ) : null}
                    <span
                        className="truncate text-[14px] font-medium leading-[18px] text-foreground"
                        title={name}
                    >
                        {name}
                    </span>
                    {row.version != null ? (
                        <span className="shrink-0 rounded-sm bg-muted px-1.5 text-[12px] leading-5 text-muted-foreground">
                            v{row.version}
                        </span>
                    ) : null}
                </span>
                {human ? (
                    <EvaluatorKeyTags names={row.feedbackKeys} />
                ) : (
                    <span className="flex min-w-0">
                        <WorkflowTypeTag isEvaluator workflowKey={row.evaluatorKey} />
                    </span>
                )}
                {narrow || human ? null : <EvaluatorTemplateTags evaluatorKey={row.evaluatorKey} />}
                {narrow ? null : <MutedCell>{formatDay(row.createdAt)}</MutedCell>}
                {narrow ? null : <MutedCell>{formatDay(row.updatedAt)}</MutedCell>}
                {narrow ? null : (
                    <MutedCell>
                        <UserAuthorLabel
                            userId={row.updatedById}
                            showYouLabel
                            showAvatar
                            fallback="—"
                        />
                    </MutedCell>
                )}
                {narrow || human ? null : <MutedCell>{row.message ?? "—"}</MutedCell>}
            </>
        )
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <StepSearch
                    value={search}
                    label="Search evaluators"
                    disabled={disabled}
                    onChange={setSearch}
                />
                {createHref ? (
                    <Button asChild variant="outline" size="sm">
                        <a href={createHref} target="_blank" rel="noopener noreferrer">
                            <PlusIcon size={14} />
                            Create new evaluator
                        </a>
                    </Button>
                ) : null}
            </div>
            <div role="group" aria-label="Evaluators">
                <ListTable
                    columns={columns}
                    minWidth={narrow ? 300 : human ? 760 : 1060}
                    loading={entries.isPending}
                    groups={groups}
                    rowKey={({row}) => row.id}
                    onOpenRow={disabled ? undefined : ({row}) => pick(row)}
                    empty={<SectionHint>No evaluators match your search</SectionHint>}
                    renderRow={renderRow}
                />
            </div>
        </div>
    )
}
