/**
 * Evaluator resolution + baseline computation (pure functions, no atoms).
 *
 * Relocated faithfully from `@agenta/annotation`'s form controller — logic
 * unchanged. `resolveEvaluators`/`computeBaseline` take a jotai `Getter` so the
 * consumer's store performs the reactive workflow-query reads; no atoms are
 * defined here.
 */

import type {Annotation} from "@agenta/entities/annotation"
import {
    workflowLatestRevisionQueryAtomFamily,
    workflowQueryAtomFamily,
    type Workflow,
} from "@agenta/entities/workflow"
import type {Getter} from "jotai"

import {getMetricFieldsFromEvaluator, getMetricsFromAnnotation} from "./schema"
import type {
    BaselineComputationResult,
    EvaluatorStepRef,
    MetricsByEvaluator,
    ResolvedEvaluatorRef,
    ResolvedEvaluators,
} from "./types"

function normalizeResolvedEvaluator(ref: EvaluatorStepRef, evaluator: Workflow): Workflow {
    const variantId = evaluator.workflow_variant_id ?? evaluator.variant_id ?? ref.variantId ?? null
    return {
        ...evaluator,
        slug: ref.slug ?? evaluator.slug ?? null,
        workflow_id: evaluator.workflow_id ?? ref.workflowId ?? null,
        workflow_variant_id: variantId,
        variant_id: variantId,
        revision_id: evaluator.revision_id ?? ref.revisionId ?? evaluator.id ?? null,
    }
}

function resolveEvaluators(get: Getter, evaluatorStepRefs: EvaluatorStepRef[]): ResolvedEvaluators {
    const resolvedRefs: ResolvedEvaluatorRef[] = []
    let isPending = false
    let hasError = false

    for (const ref of evaluatorStepRefs) {
        const revisionId = ref.revisionId ?? null
        const workflowId = ref.workflowId ?? null

        if (!revisionId && !workflowId) {
            hasError = true
            continue
        }

        const query = revisionId
            ? get(workflowQueryAtomFamily(revisionId))
            : workflowId
              ? get(workflowLatestRevisionQueryAtomFamily(workflowId))
              : null

        if (!query) {
            hasError = true
            continue
        }

        if (query.isPending && !query.data) {
            isPending = true
        }

        if (query.isError || (!query.data && !query.isPending)) {
            hasError = true
        }

        if (!query.data) continue

        const evaluator = normalizeResolvedEvaluator(ref, query.data)

        resolvedRefs.push({
            workflowId: evaluator.workflow_id ?? ref.workflowId ?? null,
            variantId:
                evaluator.workflow_variant_id ?? evaluator.variant_id ?? ref.variantId ?? null,
            revisionId: evaluator.id ?? ref.revisionId ?? null,
            stepKey: ref.stepKey ?? null,
            evaluator,
        })
    }

    return {
        evaluators: resolvedRefs.map((entry) => entry.evaluator),
        resolvedRefs,
        evaluatorResolution: {isPending, hasError},
    }
}

function computeBaseline(
    get: Getter,
    evaluatorStepRefs: EvaluatorStepRef[],
    annotations: Annotation[],
): BaselineComputationResult {
    const {evaluators, resolvedRefs, evaluatorResolution} = resolveEvaluators(
        get,
        evaluatorStepRefs,
    )
    const evaluatorMap = new Map<string, Workflow>()

    for (const resolved of resolvedRefs) {
        const evaluator = resolved.evaluator
        if (evaluator.slug) evaluatorMap.set(evaluator.slug, evaluator)
        if (resolved.workflowId) evaluatorMap.set(resolved.workflowId, evaluator)
        if (resolved.revisionId) evaluatorMap.set(resolved.revisionId, evaluator)
        if (evaluator.id) evaluatorMap.set(evaluator.id, evaluator)
    }

    const result: MetricsByEvaluator = {}

    // Add metrics from existing annotations
    for (const ann of annotations) {
        const evaluatorRef = ann.references?.evaluator
        const evaluatorKey = evaluatorRef?.slug ?? evaluatorRef?.id
        if (!evaluatorKey) continue

        const evaluator = evaluatorMap.get(evaluatorKey)
        if (!evaluator) continue

        const slug = evaluator.slug ?? evaluatorKey
        if (!slug) continue

        result[slug] = getMetricsFromAnnotation(ann, evaluator)
    }

    // Add empty metrics for unannotated evaluators
    const annotatedKeys = new Set(
        annotations
            .flatMap((a) => [a.references?.evaluator?.slug, a.references?.evaluator?.id])
            .filter(Boolean) as string[],
    )
    for (const evaluator of evaluators) {
        const slug = evaluator.slug
        if (!slug) continue
        if (annotatedKeys.has(slug)) continue
        const workflowId = evaluator.workflow_id ?? null
        if (workflowId && annotatedKeys.has(workflowId)) continue
        result[slug] = getMetricFieldsFromEvaluator(evaluator)
    }

    return {baseline: result, evaluators, resolvedRefs, evaluatorResolution}
}

export {normalizeResolvedEvaluator, resolveEvaluators, computeBaseline}
