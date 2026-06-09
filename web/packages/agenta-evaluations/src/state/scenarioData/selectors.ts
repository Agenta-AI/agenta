/**
 * Generic scenario-data + evaluator selectors — relocated faithfully from the
 * annotation session controller. Keyed PURELY by explicit `{projectId, runId[,
 * scenarioId]}` objects (no `activeRunIdAtom`/`projectIdAtom`/session reads, no
 * queue concepts).
 *
 * Molecule-only: the source-specific `directRef` fallback (scenario records) is
 * intentionally OMITTED here — the generic version reads the evaluationRun
 * molecule exclusively. The annotation package keeps that fallback in its wrapper.
 */

import {evaluationRunMolecule} from "@agenta/entities/evaluationRun"
import {fetchTestcase, type Testcase} from "@agenta/entities/testcase"
import {
    traceEntityAtomFamily,
    traceRootSpanAtomFamily,
    type TraceSpan,
} from "@agenta/entities/trace"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import type {EvaluatorColumnDef, EvaluatorStepRef} from "./types"

// ============================================================================
// KEY TYPES
// ============================================================================

export interface RunKey {
    projectId: string
    runId: string
}

function runKeyEqual(a: RunKey, b: RunKey): boolean {
    return `${a.projectId}|${a.runId}` === `${b.projectId}|${b.runId}`
}

export interface ScenarioKey {
    projectId: string
    runId: string
    scenarioId: string
}

function scenarioKeyEqual(a: ScenarioKey, b: ScenarioKey): boolean {
    return (
        `${a.projectId}|${a.runId}|${a.scenarioId}` === `${b.projectId}|${b.runId}|${b.scenarioId}`
    )
}

export interface TestcaseKey {
    projectId: string
    testcaseId: string
}

function testcaseKeyEqual(a: TestcaseKey, b: TestcaseKey): boolean {
    return `${a.projectId}|${a.testcaseId}` === `${b.projectId}|${b.testcaseId}`
}

// ============================================================================
// EVALUATOR FAMILIES — keyed by {projectId, runId}
// ============================================================================

/**
 * Evaluator workflow IDs — derived from evaluation run annotation steps.
 * Uses `step.references.evaluator.id` (workflow/artifact ID).
 */
export const evaluatorIdsAtomFamily = atomFamily(
    ({projectId, runId}: RunKey) =>
        atom<string[]>((get) => {
            if (!runId || !projectId) return []
            return get(evaluationRunMolecule.selectors.evaluatorIds({projectId, runId}))
        }),
    runKeyEqual,
)

/**
 * Evaluator revision IDs — derived from evaluation run annotation steps.
 * Uses `step.references.evaluator_revision.id` (specific revision ID).
 */
export const evaluatorRevisionIdsAtomFamily = atomFamily(
    ({projectId, runId}: RunKey) =>
        atom<string[]>((get) => {
            if (!runId || !projectId) return []
            return get(evaluationRunMolecule.selectors.evaluatorRevisionIds({projectId, runId}))
        }),
    runKeyEqual,
)

function deriveEvaluatorSlugFromStepKey(stepKey: string | null | undefined): string | null {
    if (!stepKey) return null
    const parts = stepKey.split(".").filter(Boolean)
    return parts.at(-1) ?? null
}

/**
 * Ordered evaluator references from annotation steps.
 * Each entry preserves the run's pinned evaluator revision while keeping the
 * artifact/variant IDs needed for later submits.
 */
export const evaluatorStepRefsAtomFamily = atomFamily(
    ({projectId, runId}: RunKey) =>
        atom<EvaluatorStepRef[]>((get) => {
            if (!runId || !projectId) return []

            const annotationSteps = get(
                evaluationRunMolecule.selectors.annotationSteps({projectId, runId}),
            )

            return annotationSteps
                .map((step) => ({
                    workflowId: step.references?.evaluator?.id ?? null,
                    variantId: step.references?.evaluator_variant?.id ?? null,
                    revisionId: step.references?.evaluator_revision?.id ?? null,
                    slug:
                        step.references?.evaluator?.slug ??
                        step.references?.evaluator_variant?.slug ??
                        deriveEvaluatorSlugFromStepKey(step.key) ??
                        step.references?.evaluator_revision?.slug ??
                        null,
                    stepKey: step.key ?? null,
                }))
                .filter((ref) => Boolean(ref.workflowId || ref.revisionId || ref.slug))
        }),
    runKeyEqual,
)

/**
 * Evaluator column definitions — delegates to the molecule's convenience selector.
 * Each entry represents a table column driven by an evaluation run mapping.
 *
 * Relocated from `annotationColumnDefsAtom` → `evaluatorColumnDefs`.
 */
export const evaluatorColumnDefsAtomFamily = atomFamily(
    ({projectId, runId}: RunKey) =>
        atom<EvaluatorColumnDef[]>((get) => {
            if (!runId || !projectId) return []
            return get(
                evaluationRunMolecule.selectors.annotationColumnDefs({projectId, runId}),
            ) as EvaluatorColumnDef[]
        }),
    runKeyEqual,
)

// ============================================================================
// TESTCASE DATA — keyed by {projectId, testcaseId}
// ============================================================================

/**
 * Testcase data — fetched by testcaseId via atomWithQuery.
 * Used by list view cell renderers and testcase key discovery.
 */
export const testcaseDataAtomFamily = atomFamily(
    ({projectId, testcaseId}: TestcaseKey) =>
        atomWithQuery<Testcase | null>(() => ({
            queryKey: ["evaluations-testcase", projectId, testcaseId],
            queryFn: async () => {
                if (!projectId || !testcaseId) return null
                return fetchTestcase({projectId, testcaseId})
            },
            enabled: !!projectId && !!testcaseId,
            staleTime: 5 * 60_000,
            refetchOnWindowFocus: false,
        })),
    testcaseKeyEqual,
)

// ============================================================================
// SCENARIO-DATA FAMILIES — keyed by {projectId, runId, scenarioId}
// ============================================================================

/**
 * Scenario step results — derived from evaluation run steps.
 */
export const scenarioStepsQueryStateAtomFamily = atomFamily(
    ({projectId, runId, scenarioId}: ScenarioKey) =>
        atom((get) => {
            if (!runId || !scenarioId || !projectId) return null
            return get(
                evaluationRunMolecule.selectors.scenarioSteps({projectId, runId, scenarioId}),
            )
        }),
    scenarioKeyEqual,
)

/**
 * Trace ref for a scenario — derived from evaluation run steps.
 * Resolves trace_id and span_id from the scenario's step results.
 *
 * Molecule-only: the annotation `directRef` (scenario records) fallback is omitted.
 */
export const scenarioTraceRefAtomFamily = atomFamily(
    ({projectId, runId, scenarioId}: ScenarioKey) =>
        atom((get) => {
            if (!runId || !scenarioId || !projectId) return {traceId: "", spanId: ""}
            return get(
                evaluationRunMolecule.selectors.scenarioTraceRef({projectId, runId, scenarioId}),
            )
        }),
    scenarioKeyEqual,
)

/**
 * Testcase ref for a scenario — derived from evaluation run steps.
 * Resolves testcase_id from the scenario's step results.
 *
 * Molecule-only: the annotation `directRef` (scenario records) fallback is omitted.
 */
export const scenarioTestcaseRefAtomFamily = atomFamily(
    ({projectId, runId, scenarioId}: ScenarioKey) =>
        atom((get) => {
            if (!runId || !scenarioId || !projectId) return {testcaseId: ""}
            return get(
                evaluationRunMolecule.selectors.scenarioTestcaseRef({projectId, runId, scenarioId}),
            )
        }),
    scenarioKeyEqual,
)

/**
 * Full trace query — fetched lazily via traceEntityAtomFamily.
 * Returns the TanStack query state (isPending, isError, data).
 */
export const scenarioTraceQueryAtomFamily = atomFamily(
    ({projectId, runId, scenarioId}: ScenarioKey) =>
        atom((get) => {
            const {traceId} = get(scenarioTraceRefAtomFamily({projectId, runId, scenarioId}))
            if (!traceId) return null
            return get(traceEntityAtomFamily(traceId))
        }),
    scenarioKeyEqual,
)

/**
 * Root span for a scenario — derived from traceRootSpanAtomFamily.
 * Resolves scenarioId → traceId → root span.
 */
export const scenarioRootSpanAtomFamily = atomFamily(
    ({projectId, runId, scenarioId}: ScenarioKey) =>
        atom<TraceSpan | null>((get) => {
            const {traceId} = get(scenarioTraceRefAtomFamily({projectId, runId, scenarioId}))
            if (!traceId) return null
            return get(traceRootSpanAtomFamily(traceId))
        }),
    scenarioKeyEqual,
)
