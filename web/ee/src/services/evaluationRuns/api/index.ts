import {getMetricsFromEvaluator} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/transforms"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {slugify} from "@/oss/lib/utils/slugify"

import {CreateEvaluationRunInput, TestSet} from "./types"

/**
 * Constructs the input step for a given testset, pulling variantId and revisionId
 * directly from the testset object. Any undefined reference keys are omitted.
 */

const buildInputStep = (testset?: TestSet) => {
    if (!testset) return
    const inputKey = slugify(testset.name ?? (testset as any).slug ?? "testset", testset.id)
    if (!testset) {
        return
    }

    const references: Record<string, {id: string}> = {
        testset: {id: testset.id},
    }

    // TODO: after new testsets
    // if (testset.variantId) {
    //     references.testset_variant = {id: testset.variantId}
    // }
    // if (testset.revisionId) {
    //     references.testset_revision = {id: testset.revisionId}
    // }

    return {
        key: inputKey,
        type: "input",
        origin: "auto",
        references,
    }
}

/**
 * Constructs the invocation step for a given revision.
 * Only includes reference keys if their IDs are defined.
 */
const buildInvocationStep = (revision: EnhancedVariant, inputKey: string) => {
    const invocationKey = slugify(
        (revision as any).name ?? (revision as any).variantName ?? "invocation",
        revision.id,
    )
    const references: Record<string, {id: string}> = {}
    if (revision.appId !== undefined) {
        references.application = {id: revision.appId}
    }
    if (revision.variantId !== undefined) {
        references.application_variant = {id: revision.variantId}
    }
    if (revision.id !== undefined) {
        references.application_revision = {id: revision.id}
    }
    return {
        key: invocationKey,
        type: "invocation",
        origin: "human",
        references,
        inputs: [{key: inputKey}],
    }
}

/**
 * Constructs annotation steps for all evaluators.
 * Uses each evaluator's slug and id for references.
 */
const buildAnnotationStepsFromEvaluators = (
    evaluators: EvaluatorDto[] | undefined,
    inputKey: string,
    invocationKey: string,
) => {
    if (!evaluators) return []
    return evaluators.map((evaluator) => {
        const references: Record<string, {id: string}> = {}
        if (evaluator.slug !== undefined) {
            references.evaluator = {id: evaluator.id}
        }

        // TODO: Enable when we have this information
        // if (evaluator.id !== undefined) {
        //     references.evaluator_variant = {id: evaluator.id}
        // }
        return {
            key: `${invocationKey}.${evaluator.slug}`,
            references,
            type: "annotation",
            origin: "human",
            inputs: [{key: inputKey}, {key: invocationKey}],
        }
    })
}

/**
 * Constructs the array of mappings for extracting data from steps.
 * Uses the revision's inputParams to generate "input" mappings automatically.
 *
 * @param revision - The EnhancedVariant object containing inputParams.
 * @param correctAnswerColumn - The property name in the input step for ground truth.
 * @param evaluators - Optional list of evaluators to generate evaluator mappings.
 * @param testset - The testset object to conditionally add mappings based on variantId and revisionId.
 * @returns An array of mapping objects.
 */
const buildMappings = (
    revision: EnhancedVariant,
    correctAnswerColumn: string,
    evaluators: EvaluatorDto[] | undefined,
    testset?: TestSet,
) => {
    const testsetKey = testset
        ? slugify(testset.name ?? (testset as any).slug ?? "testset", testset.id)
        : "input"
    const invocationKey = slugify(
        (revision as any).name ??
            (revision as any).variantName ??
            ((revision as any)._parentVariant as any)?.variantName ??
            "invocation",
        revision.id,
    )
    const mappings: {
        column: {kind: "testset" | "invocation" | "evaluator"; name: string}
        step: {key: string; path: string}
    }[] = []

    // Generate one "input" mapping per inputParam defined on the revision
    if (Array.isArray(revision?.inputParams)) {
        revision?.inputParams?.forEach((param: Record<string, string>) => {
            // Each inputParam has a "name" field we can use for path and label
            mappings.push({
                column: {kind: "testset", name: param.name},
                step: {key: testsetKey, path: `data.${param.name}`},
            })
        })

        if (revision.isChatVariant) {
            mappings.push({
                column: {kind: "testset", name: "messages"},
                step: {key: testsetKey, path: "data.messages"},
            })
        }
    }

    // Ground truth mapping using the provided column name
    // mappings.push({
    //     column: {kind: "testset", name: correctAnswerColumn},
    //     step: {key: testsetKey, path: `data.${correctAnswerColumn}`},
    // })

    // Application output mapping should use canonical column name "outputs" to align with backend
    mappings.push({
        column: {kind: "invocation", name: "outputs"},
        step: {key: invocationKey, path: "attributes.ag.data.outputs"},
    })

    // Add mappings for testset variantId and revisionId if available
    // Additional metadata mappings if available
    if (testset?.variantId !== undefined) {
        mappings.push({
            column: {kind: "testset", name: "testset_variant_id"},
            step: {key: testsetKey, path: "data.variantId"},
        })
    }
    if (testset?.revisionId !== undefined) {
        mappings.push({
            column: {kind: "testset", name: "testset_revision_id"},
            step: {key: testsetKey, path: "data.revisionId"},
        })
    }

    // Evaluator output mappings generated dynamically per evaluator
    if (evaluators && evaluators.length > 0) {
        evaluators?.forEach((evaluator) => {
            const metrics = getMetricsFromEvaluator(evaluator)
            Object.keys(metrics).forEach((key) => {
                mappings.push({
                    column: {kind: "evaluator", name: `${evaluator.slug}.${key}`},
                    step: {key: `${invocationKey}.${evaluator.slug}`, path: `data.outputs.${key}`},
                })
            })
        })
    }

    return mappings
}

/**
 * Builds the payload required for submitting multiple evaluation runs to the backend.
 * Each revision will be wrapped in its own run configuration.
 * This function returns an object with a `runs` array that can be sent to
 * the POST `/api/preview/evaluations/runs/` endpoint.
 *
 * @param name - Base name used in each run
 * @param testset - The test set being used in this evaluation (must include variantId & revisionId).
 * @param revisions - List of enhanced variant revisions; one run will be generated per revision.
 * @param evaluators - List of available evaluators used in annotation.
 * @param correctAnswerColumn - The property name in the input step that holds the ground truth value.
 * @param meta - Optional metadata object to attach to each run.
 * @returns Object containing `runs` array, ready to be POSTed to the backend.
 */
export const createEvaluationRunConfig = ({
    name,
    testset,
    revisions,
    evaluators,
    correctAnswerColumn,
    meta = {}, // Default to empty object if not provided
}: CreateEvaluationRunInput) => {
    // Pre-build the input step (which now includes variantId & revisionId) and mappings
    const inputStep = buildInputStep(testset)
    const inputKey = slugify(testset?.name ?? (testset as any)?.slug ?? "testset", testset!.id)
    const invocationKeysCache: Record<string, string> = {}

    // Create one run configuration per revision
    const runs = revisions.map((revision) => {
        const invocationKey =
            invocationKeysCache[revision.id] ??
            slugify(
                (revision as any).name ?? (revision as any).variantName ?? "invocation",
                revision.id,
            )
        invocationKeysCache[revision.id] = invocationKey

        const steps = [
            inputStep,
            buildInvocationStep(revision, inputKey),
            ...buildAnnotationStepsFromEvaluators(evaluators, inputKey, invocationKey),
        ]
        // Build mappings for this revision, passing testset as well
        const mappings = buildMappings(revision, correctAnswerColumn, evaluators, testset)
        return {
            key: `evaluation-${revision.variantId}`,
            name: `${name}`,
            description: "auto-generated evaluation run",
            meta, // Include the passed-in meta object
            data: {steps, mappings},
        }
    })

    return {runs}
}
