import {format3Sig, type EvaluationRunScenario} from "@agenta/entities/evaluationRun"
import {
    groupRunColumns,
    resolveMappings,
    type ColumnGroup,
    type HydratedScenarioRow,
    type RunColumnGroup,
    type RunMapping,
    type RunStep,
} from "@agenta/entities/evaluationRun/etl"

/** The run's column spec: its steps and the mappings that name the columns. */
export interface ScenarioSchema {
    steps: RunStep[]
    mappings: RunMapping[]
}

/** One value of a scenario: a column of one group. */
export interface ScenarioCell {
    name: string
    /** The group kind, which picks how the value is drawn. */
    kind: ColumnGroup["kind"]
    /** The mapping path, which tells a metric what it measures. */
    path: string
    value: unknown
}

/** A scenario with its values already picked out of the hydrated entities. */
export interface ScenarioRowData {
    scenario: EvaluationRunScenario
    /** Cells by group key, in the order of the group's columns. */
    cells: Record<string, ScenarioCell[]>
}

/** A scenario row as the screen shows it: its position in the list comes with it. */
export interface ScenarioRow extends ScenarioRowData {
    /** 1-based position in the order the API returned the scenarios. */
    index: number
}

/** A name the group shows when its test set, app or evaluator has no name yet. */
export function groupFallbackLabel(group: ColumnGroup): string {
    if (group.kind === "testset") return group.slug ? `Test set ${group.slug}` : "Test set"
    return group.label
}

/** The column groups of a run, in display order. */
export function scenarioColumnGroups(schema: ScenarioSchema): RunColumnGroup[] {
    return groupRunColumns(schema.steps, schema.mappings)
}

/** Resolve the values of one hydrated scenario, grouped like the headers. */
export function buildScenarioRowData(
    hydrated: HydratedScenarioRow<EvaluationRunScenario>,
    schema: ScenarioSchema,
): ScenarioRowData {
    const cells: Record<string, ScenarioCell[]> = {}
    // `resolveMappings` returns one column per mapping, in the mappings' order.
    resolveMappings(hydrated, schema).forEach((column, position) => {
        if (!isListedColumn(schema.mappings[position])) return
        const list = (cells[column.group.key] ??= [])
        list.push({
            name: column.name,
            kind: column.group.kind,
            path: column.path,
            value: column.value,
        })
    })
    return {scenario: hydrated.scenario, cells}
}

/** The rule `groupRunColumns` uses: a column needs a name, and internal dedup keys are not listed. */
function isListedColumn(mapping: RunMapping | undefined): boolean {
    const name = mapping?.column?.name
    return typeof name === "string" && name !== "" && !name.includes("_dedup_id")
}

const TERMINAL_SCENARIO_STATUSES: ReadonlySet<string> = new Set([
    "success",
    "failure",
    "failed",
    "error",
    "errors",
    "cancelled",
    "completed",
    "finished",
])

/** True when a scenario has stopped changing. A scenario with no status counts as still open. */
export function isTerminalScenarioStatus(status: string | null | undefined): boolean {
    return typeof status === "string" && TERMINAL_SCENARIO_STATUSES.has(status.toLowerCase())
}

interface FrequencyEntry {
    value: unknown
    count?: number
}

/**
 * A short text for a score. A scenario's metric is a one-row summary: a number, a flag, or a
 * count of each value seen, so a count of values reads as the most common one.
 */
export function scoreText(value: unknown): string | null {
    if (value === null || value === undefined || value === "") return null
    if (typeof value === "boolean") return String(value)
    if (typeof value === "number") return format3Sig(value)
    if (typeof value === "string") return value
    if (typeof value !== "object") return null
    const stats = value as {mean?: unknown; freq?: unknown; frequency?: unknown}
    if (typeof stats.mean === "number") return format3Sig(stats.mean)
    const counts = [stats.freq, stats.frequency].find(Array.isArray) as FrequencyEntry[] | undefined
    const top = counts?.reduce<FrequencyEntry | null>(
        (best, entry) => (!best || (entry.count ?? 0) > (best.count ?? 0) ? entry : best),
        null,
    )
    return top && top.value !== null && top.value !== undefined ? String(top.value) : null
}
