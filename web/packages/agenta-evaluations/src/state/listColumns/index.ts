/**
 * @agenta/evaluations — session-scoped list-column tier.
 *
 * Relocated faithfully from the annotation session controller and
 * re-parameterized to read the session engine's INJECTED scenario-source
 * `kind` + `{projectId, runId}` context (via `evaluationSessionController`)
 * and the generic `scenarioDataSelectors`. No queue concepts, no
 * `@agenta/annotation` dependency.
 */

export {listColumnSelectors, type ListColumnSelectors, OUTPUT_KEYS} from "./columns"
export {getTraceInputDisplayKeys, getTraceInputDisplayValue} from "./traceInputDisplay"

export type {
    ScenarioListColumnDef,
    IndexColumnDef,
    TraceNameColumnDef,
    TraceInputGroupColumnDef,
    TraceOutputColumnDef,
    TestcaseColumnDef,
    AnnotationDataColumnDef,
    AnnotationOutputColumnDef,
    StatusColumnDef,
    ActionsColumnDef,
} from "./types"
