/**
 * The columns of the evaluation runs list, copied from the old app's list
 * (web/oss `EvaluationRunsTablePOC/hooks/useEvaluationRunsColumns` and `utils/referenceSchema.ts`)
 * as pure functions.
 *
 * The old list picks its columns from the runs on screen: a reference column (test set, query,
 * application) for each kind of reference a run points at, one metric column per evaluator
 * metric (grouped under the evaluator), and the four invocation metrics. The Kind column shows on
 * the All tab only. With no runs to read, the tab decides the reference columns.
 *
 * @packageDocumentation
 */

import type {MetricStats} from "./metricStats"
import type {RunListTab} from "./runFilters"

/** A reference column, in the old list's order. */
export type RunListReferenceColumn = "testset" | "query" | "application"

const REFERENCE_ORDER: readonly RunListReferenceColumn[] = ["testset", "query", "application"]

/** The step reference keys that make a run show each reference column. */
const REFERENCE_KEYS: Record<RunListReferenceColumn, readonly string[]> = {
    testset: ["testset", "test_set", "testsets", "testset_variant", "testset_revision"],
    query: ["query", "query_variant", "query_revision"],
    application: [
        "application",
        "application_revision",
        "agent",
        "agent_revision",
        "application_variant",
    ],
}

/** The old list's columns for a tab with no runs to read. */
const TAB_REFERENCES: Record<RunListTab, readonly RunListReferenceColumn[]> = {
    all: REFERENCE_ORDER,
    auto: ["testset", "application"],
    human: ["testset", "application"],
    online: ["query"],
    custom: ["testset", "application"],
}

/** One evaluator metric column. */
export interface RunListMetricColumn {
    /** `{group}:{metricPath}`: the same column across runs. */
    id: string
    /** The metric key in the run-level metrics, for example `attributes.ag.data.outputs.score`. */
    metricKey: string
    /** "Score", "Success". */
    label: string
    /** The step that reports this metric in each run. A run absent here has no such metric. */
    stepKeysByRunId: Record<string, string>
}

/** The metric columns of one evaluator. */
export interface RunListEvaluatorGroup {
    /** The evaluator's slug, else its id, else the step key. */
    id: string
    evaluatorId: string | null
    evaluatorSlug: string | null
    /** A revision of the evaluator the runs used: its output schema says which metrics are text. */
    evaluatorRevisionId: string | null
    columns: RunListMetricColumn[]
}

/** An invocation metric column. */
export interface RunListInvocationColumn {
    id: "cost" | "duration" | "tokens" | "errors"
    metricKey: string
    label: string
}

/** The four invocation metrics, in the old list's order. */
export const RUN_LIST_INVOCATION_COLUMNS: readonly RunListInvocationColumn[] = [
    {id: "cost", metricKey: "attributes.ag.metrics.costs.cumulative.total", label: "Cost"},
    {id: "duration", metricKey: "attributes.ag.metrics.duration.cumulative", label: "Duration"},
    {id: "tokens", metricKey: "attributes.ag.metrics.tokens.cumulative.total", label: "Tokens"},
    {id: "errors", metricKey: "attributes.ag.metrics.errors.cumulative", label: "Errors"},
]

export interface RunListColumns {
    /** The Kind column: the All tab only. */
    showKind: boolean
    references: RunListReferenceColumn[]
    /**
     * Evaluators in the order of their slug (the names load later, and the columns must not move
     * when they do); each evaluator's metrics by label.
     */
    evaluators: RunListEvaluatorGroup[]
    invocation: readonly RunListInvocationColumn[]
}

interface ColumnsRunStep {
    key: string
    type?: string | null
    references?: Record<string, {id?: string | null; slug?: string | null} | null> | null
}

interface ColumnsRunMapping {
    column?: {kind?: string | null; name?: string | null} | null
    step?: {key: string; path?: string | null} | null
}

export interface ColumnsRun {
    id: string
    data?: {
        steps?: readonly ColumnsRunStep[] | null
        mappings?: readonly ColumnsRunMapping[] | null
    } | null
}

const UPPERCASE_WORDS = new Set(["json", "csv", "xml", "html", "id", "llm", "api", "url"])

const humanizeWord = (raw: string) => {
    const lower = raw.toLowerCase()
    if (UPPERCASE_WORDS.has(lower)) return lower.toUpperCase()
    if (lower === "outputs") return "Output"
    if (lower === "inputs") return "Input"
    return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/**
 * A metric path as a column label, the old app's `humanizeMetricPath`:
 * `attributes.ag.data.outputs.score` -> "Score", `outputs.is_valid` -> "Is Valid".
 */
export function humanizeMetricPath(metricPath: string): string {
    const trimmed = metricPath
        .replace(/^attributes\.ag\.data\.outputs\./, "")
        .replace(/^attributes\.ag\.data\./, "")
        .replace(/^attributes\.ag\./, "")
        .replace(/^attributes\./, "")
    const segments = trimmed
        .split(".")
        .map((segment) => segment.replace(/[-_]/g, " ").trim())
        .filter(Boolean)
    if (segments.length === 0) return metricPath
    const focus = segments.length > 2 ? segments.slice(-2) : segments
    return focus.join(" ").split(/\s+/).filter(Boolean).map(humanizeWord).join(" ")
}

const nonEmpty = (value: string | null | undefined): string | null => {
    const trimmed = value?.trim()
    return trimmed ? trimmed : null
}

const hasReference = (step: ColumnsRunStep, column: RunListReferenceColumn) =>
    REFERENCE_KEYS[column].some((key) => Boolean(step.references?.[key]))

/**
 * The reference columns the runs need, in the old list's order; the tab's set when no run says.
 */
function referenceColumns(runs: readonly ColumnsRun[], tab: RunListTab): RunListReferenceColumn[] {
    if (runs.length === 0) return [...TAB_REFERENCES[tab]]
    const present = REFERENCE_ORDER.filter((column) =>
        runs.some((run) => (run.data?.steps ?? []).some((step) => hasReference(step, column))),
    )
    return present.length > 0 ? present : [...TAB_REFERENCES[tab]]
}

/** The evaluator metric columns of the runs, grouped by evaluator. */
function evaluatorGroups(runs: readonly ColumnsRun[]): RunListEvaluatorGroup[] {
    const groups = new Map<
        string,
        RunListEvaluatorGroup & {metrics: Map<string, RunListMetricColumn>}
    >()
    for (const run of runs) {
        const steps = new Map<string, ColumnsRunStep>()
        for (const step of run.data?.steps ?? []) {
            if (step.type === "annotation") steps.set(step.key, step)
        }
        for (const mapping of run.data?.mappings ?? []) {
            const kind = mapping.column?.kind
            if (kind && kind !== "annotation" && kind !== "evaluator") continue
            const stepKey = mapping.step?.key
            const path = nonEmpty(mapping.step?.path)
            const step = stepKey ? steps.get(stepKey) : undefined
            if (!step || !stepKey || !path) continue
            const evaluator = step.references?.evaluator
            const evaluatorSlug = nonEmpty(evaluator?.slug)
            const evaluatorId = nonEmpty(evaluator?.id)
            const evaluatorRevisionId = nonEmpty(step.references?.evaluator_revision?.id)
            const groupId = evaluatorSlug ?? evaluatorId ?? stepKey
            let group = groups.get(groupId)
            if (!group) {
                group = {
                    id: groupId,
                    evaluatorId,
                    evaluatorSlug,
                    evaluatorRevisionId,
                    columns: [],
                    metrics: new Map(),
                }
                groups.set(groupId, group)
            }
            group.evaluatorId ??= evaluatorId
            group.evaluatorRevisionId ??= evaluatorRevisionId
            const columnId = `${groupId}:${path}`
            const column = group.metrics.get(columnId)
            if (column) {
                column.stepKeysByRunId[run.id] = stepKey
            } else {
                group.metrics.set(columnId, {
                    id: columnId,
                    metricKey: path,
                    label: humanizeMetricPath(nonEmpty(mapping.column?.name) ?? path),
                    stepKeysByRunId: {[run.id]: stepKey},
                })
            }
        }
    }
    return [...groups.values()]
        .map(({metrics, ...group}) => ({
            ...group,
            columns: [...metrics.values()].sort((a, b) => a.label.localeCompare(b.label)),
        }))
        .filter((group) => group.columns.length > 0)
        .sort((a, b) => a.id.localeCompare(b.id))
}

/** The columns of the runs list for a tab and the runs on screen. */
export function runListColumns(runs: readonly ColumnsRun[], tab: RunListTab): RunListColumns {
    return {
        showKind: tab === "all",
        references: referenceColumns(runs, tab),
        evaluators: evaluatorGroups(runs),
        invocation: RUN_LIST_INVOCATION_COLUMNS,
    }
}

const OUTPUT_PREFIX = /^attributes\.ag\.data\.outputs\.?/

/**
 * True when the evaluator's output schema types this metric as a string (a comment, a reason).
 * The old list hides those columns: text does not aggregate. The metric is looked up by its path
 * under the outputs, then by its last segment.
 */
export function isTextOutputMetric(outputsSchema: unknown, metricKey: string): boolean {
    if (typeof outputsSchema !== "object" || outputsSchema === null) return false
    const properties = (outputsSchema as {properties?: unknown}).properties
    if (typeof properties !== "object" || properties === null) return false
    const path = metricKey.replace(OUTPUT_PREFIX, "")
    const leaf = path.split(".").pop() ?? path
    const property =
        (properties as Record<string, unknown>)[path] ??
        (properties as Record<string, unknown>)[leaf]
    if (typeof property !== "object" || property === null) return false
    const type = (property as {type?: unknown}).type
    return typeof type === "string" && type.toLowerCase() === "string"
}

/** How a metric cell draws its stats, the old list's `RunMetricCell` rule. */
export type RunMetricCellView =
    | {kind: "bar"; segments: {label: string; value: number}[]}
    | {kind: "categories"; text: string}
    | {kind: "text"; text: string}

/**
 * An evaluator metric with a value count draws a true/false bar (two values or fewer) or its most
 * frequent value with the count (more than two). Any other metric is text.
 */
export function runMetricCellView(
    kind: "evaluator" | "invocation",
    stats: MetricStats | null | undefined,
    text: string,
): RunMetricCellView {
    if (kind === "evaluator" && stats?.frequency?.length) {
        const entries = stats.frequency
            .filter((entry) => entry.value !== undefined && entry.value !== null)
            .map((entry) => ({label: String(entry.value), value: entry.count}))
            .filter((entry) => entry.label.length > 0)
            .sort((a, b) => b.value - a.value)
        const total = entries.reduce((sum, entry) => sum + entry.value, 0)
        if (entries.length > 0 && total > 0) {
            if (entries.length > 2) {
                return {kind: "categories", text: `${entries[0].label} (${entries[0].value})`}
            }
            return {kind: "bar", segments: entries}
        }
    }
    return {kind: "text", text}
}

/**
 * The columns left after the reader hid some in the column menu, by column key: a reference
 * ("testset"), an evaluator metric (its `id`) or an invocation metric ("cost"). An evaluator with
 * every metric hidden drops out. The Kind column is not hideable, as in the old list.
 */
export function visibleRunListColumns(
    plan: RunListColumns,
    hiddenKeys: ReadonlySet<string>,
): RunListColumns {
    if (hiddenKeys.size === 0) return plan
    return {
        ...plan,
        references: plan.references.filter((reference) => !hiddenKeys.has(reference)),
        evaluators: plan.evaluators
            .map((group) => ({
                ...group,
                columns: group.columns.filter((column) => !hiddenKeys.has(column.id)),
            }))
            .filter((group) => group.columns.length > 0),
        invocation: plan.invocation.filter((column) => !hiddenKeys.has(column.id)),
    }
}
