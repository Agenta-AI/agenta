/**
 * Fixtures for `Outputs.stories.tsx` — the execution-result surfaces.
 *
 * ## The seam these use
 *
 * `PlaygroundOutputs` reads run results through
 * `executionItemController.selectors.fullResult({rowId, entityId})`, which resolves
 * `derivedLoadableIdAtom` → `resultAtomFamily({loadableId, stepId, sessionId})`. Both ends of
 * that chain turn out to be reachable without the loadable/testcase graph:
 *
 * - `derivedLoadableIdAtom` (execution/selectors.ts:146) is derived PURELY from
 *   `playgroundNodesAtom`, a `PrimitiveAtom<PlaygroundNode[]>`. Seeding one depth-0 node makes
 *   the loadable id deterministic: `testset:<entityType>:<entityId>`.
 * - `resultsByKeyAtomFamily(loadableId)` (execution/atoms.ts:282) is a READ/WRITE atom over
 *   the execution state. Seeding it puts real `RunResult`s in front of the selector.
 *
 * So the outputs surface needs no `_fixtures/playgroundLoadable.ts` — two writable atoms and a
 * revision query per node are enough. (`PlaygroundInputsBodyHost` is the one that still needs
 * the row graph; see the story file.)
 *
 * ## Key formats — get these wrong and the story renders an empty card
 *
 * - result key: `` `${rowId}:sess:${entityId}` `` (`buildResultKey(stepId, sessionId)` with
 *   `sessionId = "sess:" + entityId`).
 * - a DOWNSTREAM node's result is stored under a SCOPED entity id,
 *   `` `${rootEntityId}:${nodeEntityId}` `` — so its key is
 *   `` `${rowId}:sess:${rootEntityId}:${nodeEntityId}` ``.
 * - `output` is unwrapped by `deriveToolViewModelFromResult`, which reads
 *   `result.response.data` — a bare string renders blank.
 */

import type {PlaygroundNode} from "@agenta/entities/runnable"
import type {QueryKey} from "@tanstack/react-query"

export const ROW_ID = "row-outputs-1"

export const APP_ID = "rev-classify-outputs"
export const EVAL_A_ID = "rev-exactmatch-outputs"
export const EVAL_B_ID = "rev-llmjudge-outputs"
/** Second root, used by the comparison story. */
export const APP_B_ID = "rev-classify-v2-outputs"

/** `derivedLoadableIdAtom` builds this from the FIRST depth-0 node. */
export const loadableIdFor = (entityId: string) => `testset:workflow:${entityId}`

export const node = (
    entityId: string,
    depth: number,
    label: string,
    id = `node-${entityId}`,
): PlaygroundNode => ({id, entityId, entityType: "workflow", depth, label})

/** Text response — the ordinary success shape the editor renders. */
export const textResult = (entityId: string, text: string) => ({
    status: "success" as const,
    sessionId: `sess:${entityId}`,
    traceId: null,
    output: {response: {data: text}},
})

/**
 * Structured evaluator output — `extractDisplayEntries` turns this into the field grid.
 *
 * The `response.outputs` envelope is load-bearing, and the two obvious alternatives both fail
 * silently (the card renders a bare em-dash, which passes every gate):
 *
 * - a bare `{score, success}` object → `extractDisplayEntries` reads `output.response` first
 *   and gives up, returning `null`.
 * - `response.data = {score, success}` → the entries come back, but in `ExecutionResultView`
 *   `deriveToolViewModelFromResult` has already serialised that same object into a non-empty
 *   `displayValue`, and the evaluator branch is gated on `displayValue` being falsy — so the
 *   result renders as a JSON blob in the editor instead of as a grid.
 *
 * `response.outputs` (no `data`) is the one shape that reaches the grid on both paths.
 */
export const evaluatorResult = (
    entityId: string,
    outputs: Record<string, unknown>,
    status: "success" | "error" | "skipped" | "running" | "idle" = "success",
) => ({
    status,
    sessionId: `sess:${entityId}`,
    traceId: null,
    output: {response: {outputs}},
})

export const errorResult = (entityId: string, message: string) => ({
    status: "error" as const,
    sessionId: `sess:${entityId}`,
    traceId: null,
    error: {message},
})

/** `${rowId}:sess:${entityId}` — `buildResultKey` with the playground's session convention. */
export const resultKey = (rowId: string, entityId: string) => `${rowId}:sess:${entityId}`

/** Downstream nodes store under `${rootEntityId}:${nodeEntityId}`. */
export const downstreamResultKey = (rowId: string, rootEntityId: string, nodeEntityId: string) =>
    `${rowId}:sess:${rootEntityId}:${nodeEntityId}`

/**
 * A workflow revision as `workflowMolecule.selectors.data(id)` reads it —
 * `["workflows", "revision", id, projectId]` (workflow store.ts:1187). Nothing warns when it
 * is missing; the card just falls back to a generic "Workflow" label with no version.
 */
export const revisionQuery = (
    projectId: string,
    id: string,
    opts: {
        name: string
        version?: number
        isEvaluator?: boolean
        /** `schemas.inputs.properties` — becomes the node's INPUT ports (variable cards). */
        inputs?: Record<string, {type: string; title?: string}>
        /** `schemas.outputs.properties` — becomes the node's output ports. */
        outputs?: Record<string, {type: string; title?: string}>
        /** Bounds the evaluator score, rendered as `7.5 / 10` by the field grid. */
        feedbackConfig?: Record<string, unknown>
    },
): [QueryKey, unknown] => [
    ["workflows", "revision", id, projectId],
    {
        id,
        workflow_id: `wf-${id}`,
        slug: opts.name.toLowerCase().replace(/\s+/g, "-"),
        name: opts.name,
        version: opts.version ?? 1,
        flags: opts.isEvaluator ? {is_evaluator: true} : {},
        data: {
            schemas: {
                ...(opts.inputs ? {inputs: {type: "object", properties: opts.inputs}} : {}),
                ...(opts.outputs ? {outputs: {type: "object", properties: opts.outputs}} : {}),
            },
            parameters: opts.feedbackConfig ? {feedback_config: opts.feedbackConfig} : {},
        },
    },
]

/**
 * Loadable state that names a linked runnable.
 *
 * `loadableColumnsFromRunnableAtomFamily` (runnable/bridge.ts:31) returns the loadable's own
 * (empty) column list unless `linkedRunnableType` + `linkedRunnableId` are both set — only then
 * does it delegate to `workflowMolecule.selectors.inputPorts`. Without this seed the inputs
 * body has no referenced variables and renders nothing, silently.
 */
export const linkedLoadableState = (entityId: string, name: string) => ({
    columns: [],
    activeRowId: null,
    name,
    connectedSourceId: null,
    connectedSourceName: null,
    connectedSourceType: null,
    linkedRunnableType: "workflow" as const,
    linkedRunnableId: entityId,
    executionResults: {},
    outputMappings: [],
    hiddenTestcaseIds: new Set<string>(),
    disabledOutputMappingRowIds: new Set<string>(),
})

/** 0–10 bounded score, so the grid renders `7.5 / 10` rather than a bare number. */
export const SCORE_0_10 = {
    json_schema: {schema: {properties: {score: {type: "number", minimum: 0, maximum: 10}}}},
}
