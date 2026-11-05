import {format3Sig, type EvaluationRunScenario} from "@agenta/entities/evaluationRun"
import {
    computeColumnGroup,
    findInTrace,
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
    /** True when the traces of this scenario did not load: its outputs and scores are unknown. */
    valuesFailed: boolean
    /**
     * The result of the step that holds the scenario's trace, when it has one yet: the app call,
     * or on a live run the trace the run read.
     */
    invocation: ScenarioInvocation | null
    /** The error message of each failed step, by the key of the group that shows the step. */
    errors: Record<string, string>
    /** The error messages of failed steps that no shown group stands for. */
    otherErrors: string[]
}

/** What the run produced for one scenario: where its trace is and how the step ended. */
export interface ScenarioInvocation {
    traceId: string | null
    status: string | null
}

/** A scenario row as the screen shows it: its position in the list comes with it. */
export interface ScenarioRow extends ScenarioRowData {
    /** 1-based position in the order the API returned the scenarios. */
    index: number
}

/** A name the group shows when its test set, app or evaluator has no name yet. */
export function groupFallbackLabel(group: ColumnGroup): string {
    if (group.kind === "testset" && !isTraceGroup(group)) {
        return group.slug ? `Test set ${group.slug}` : "Test set"
    }
    return group.label
}

/**
 * A live run reads traces, not a test set. Its input step has one mapping of kind `query`, whose
 * path (`attributes.ag.data`) holds the inputs and the outputs of the trace.
 */
const isQueryMapping = (mapping: RunMapping) => mapping.column?.kind === "query"

const TRACE_INPUTS = "trace-inputs:"
const TRACE_OUTPUTS = "trace-outputs:"

const isTraceGroup = (group: ColumnGroup) =>
    group.key.startsWith(TRACE_INPUTS) || group.key.startsWith(TRACE_OUTPUTS)

/** The two groups of a trace the run read: its inputs, shown as inputs, and its outputs. */
function traceGroups(step: RunStep): {inputs: RunColumnGroup; outputs: RunColumnGroup} {
    const refs = step.references ?? null
    const group = (kind: "testset" | "application", key: string, label: string, name: string) => ({
        group: {kind, slug: null, label, key: `${key}${step.key}`, refs},
        columns: [{name, kind, groupSlug: null}],
    })
    return {
        inputs: group("testset", TRACE_INPUTS, "Inputs", "inputs"),
        outputs: group("application", TRACE_OUTPUTS, "Outputs", "outputs"),
    }
}

/** The query mappings of a run with their steps, in mapping order. */
function queryMappings(schema: ScenarioSchema): {mapping: RunMapping; step: RunStep}[] {
    return schema.mappings.flatMap((mapping) => {
        const step = schema.steps.find((candidate) => candidate.key === mapping.step?.key)
        return isQueryMapping(mapping) && step ? [{mapping, step}] : []
    })
}

/** The column groups of a run, in display order. */
export function scenarioColumnGroups(schema: ScenarioSchema): RunColumnGroup[] {
    const traces = queryMappings(schema).map(({step}) => traceGroups(step))
    return [
        ...traces.map(({inputs}) => inputs),
        ...traces.map(({outputs}) => outputs),
        ...groupRunColumns(
            schema.steps,
            schema.mappings.filter((mapping) => !isQueryMapping(mapping)),
        ),
    ]
}

/** Resolve the values of one hydrated scenario, grouped like the headers. */
export function buildScenarioRowData(
    hydrated: HydratedScenarioRow<EvaluationRunScenario>,
    schema: ScenarioSchema,
    valuesFailed = false,
): ScenarioRowData {
    const cells: Record<string, ScenarioCell[]> = {}
    const resultOf = (stepKey: string) =>
        hydrated.results.find((entry) => entry.step_key === stepKey)

    // A trace the run read: its inputs and outputs come from the trace, not from a test case.
    const queries = queryMappings(schema)
    for (const {mapping, step} of queries) {
        const traceId = resultOf(step.key)?.trace_id
        const trace = traceId ? hydrated.traces[traceId] : undefined
        const {inputs, outputs} = traceGroups(step)
        const path = mapping.step?.path ?? ""
        for (const {group} of [inputs, outputs]) {
            const name = group.kind === "testset" ? "inputs" : "outputs"
            cells[group.key] = [
                {
                    name,
                    kind: group.kind,
                    path: `${path}.${name}`,
                    value: trace === undefined ? undefined : findInTrace(trace, `${path}.${name}`),
                },
            ]
        }
    }

    const mappings = schema.mappings.filter((mapping) => !isQueryMapping(mapping))
    // `resolveMappings` returns one column per mapping, in the mappings' order.
    resolveMappings(hydrated, {steps: schema.steps, mappings}).forEach((column, position) => {
        if (!isListedColumn(mappings[position])) return
        const list = (cells[column.group.key] ??= [])
        list.push({
            name: column.name,
            kind: column.group.kind,
            path: column.path,
            value: column.value,
        })
    })

    const invocationKey =
        schema.steps.find((step) => step.type === "invocation")?.key ?? queries[0]?.step.key
    const result = invocationKey ? resultOf(invocationKey) : undefined
    const invocation = result
        ? {traceId: result.trace_id ?? null, status: result.status ?? null}
        : null

    // Each failed step's message goes under the group that shows the step. Two steps in one
    // group (two runs of one evaluator) keep both messages. A step with no shown group (an app
    // step with no listed output) still shows its message, with the scenario.
    const shown = new Set(scenarioColumnGroups(schema).map(({group}) => group.key))
    const errors: Record<string, string> = {}
    const otherErrors: string[] = []
    for (const step of schema.steps) {
        const message = stepErrorMessage(resultOf(step.key))
        if (!message) continue
        const traceGroup = queries.some((query) => query.step.key === step.key)
        const key = traceGroup
            ? traceGroups(step).outputs.group.key
            : computeColumnGroup(step, "").key
        if (!shown.has(key)) otherErrors.push(message)
        else errors[key] = errors[key] ? `${errors[key]}; ${message}` : message
    }
    return {scenario: hydrated.scenario, cells, valuesFailed, invocation, errors, otherErrors}
}

const FAILED_STATUSES: ReadonlySet<string> = new Set(["failure", "failed", "error", "errors"])

/** True when a step or a scenario ended in an error. */
export const isFailedStatus = (status: string | null | undefined) =>
    typeof status === "string" && FAILED_STATUSES.has(status.toLowerCase())

/** The message of a failed step, else null. */
function stepErrorMessage(
    result: {status?: string | null; error?: Record<string, unknown> | null} | undefined,
): string | null {
    if (!result || !isFailedStatus(result.status)) return null
    const message = result.error?.message
    return typeof message === "string" && message.trim() ? message.trim() : null
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
