import {extractSourceIdFromDraft, isLocalDraftId, isValidUUID} from "@agenta/entities/shared"
import {
    extractAllEndpointSchemas,
    extractInputKeysFromSchema,
} from "@agenta/entities/shared/openapi"
import type {Workflow} from "@agenta/entities/workflow"

import {extractEvaluatorMetricKeys} from "./extractEvaluatorMetricKeys"
import {slugify} from "./slugify"
import type {
    BuildRunConfigInput,
    BuildRunConfigResult,
    RevisionSchemaContext,
    RunConfigTestset,
    RunMapping,
    RunStep,
} from "./types"

/**
 * buildRunConfig — PURE construction of evaluation-run payloads (steps + mappings).
 *
 * This is the headless, jotai-free port of OSS `createEvaluationRunConfig`
 * (`web/oss/src/services/evaluationRuns/api/index.ts`). The original read four
 * playground/workflow atoms via `getDefaultStore()` inside `buildMappings`:
 *   currentAppContextAtom, appOpenApiSchemaAtomFamily(revisionId),
 *   appRoutePathAtomFamily(revisionId), workflowMolecule.selectors.inputSchema(revisionId).
 *
 * Those are now supplied as plain data via `input.schemaContextByRevisionId` (the OSS
 * `-ui` provider resolves the atoms and passes the snapshot in). The result: this module
 * imports ZERO jotai / playground / getDefaultStore — it is a pure function, fully unit
 * testable without a frontend or a store. (Spike T3: proves the package boundary holds.)
 */

const EMPTY_SCHEMA_CONTEXT: RevisionSchemaContext = {
    isCustom: false,
    spec: null,
    routePath: "",
    inputSchemaProperties: null,
}

const extractColumnsFromTestset = (testset?: RunConfigTestset): string[] => {
    if (!testset) return []

    const columns = new Set<string>()

    const addColumnsFromObject = (obj?: Record<string, unknown>) => {
        if (!obj || typeof obj !== "object") return
        Object.keys(obj).forEach((key) => {
            if (!key || typeof key !== "string") return
            if (key.startsWith("__")) return
            columns.add(key)
        })
    }

    const csvRows = testset.csvdata
    if (Array.isArray(csvRows) && csvRows.length > 0) {
        addColumnsFromObject(csvRows[0] as Record<string, unknown>)
    }

    const data = testset.data
    if (data) {
        const testcases = data.testcases
        if (Array.isArray(testcases) && testcases.length > 0) {
            const first = testcases[0] as {data?: Record<string, unknown>} & Record<string, unknown>
            addColumnsFromObject((first && (first.data || first)) as Record<string, unknown>)
        }

        const columnsList = data.columns || data.columnNames
        if (Array.isArray(columnsList)) {
            columnsList.forEach((col) => {
                if (typeof col === "string" && col && !col.startsWith("__")) {
                    columns.add(col)
                }
            })
        }
    }

    return Array.from(columns)
}

/**
 * Resolve a server revision ID for invocation references.
 * Local drafts use non-UUID IDs, so we fall back to their source revision.
 */
const resolveWorkflowRevisionId = (workflow: Workflow): string | undefined => {
    if (isValidUUID(workflow.id)) return workflow.id

    const sourceRevisionId = isLocalDraftId(workflow.id)
        ? extractSourceIdFromDraft(workflow.id)
        : null

    if (sourceRevisionId && isValidUUID(sourceRevisionId)) {
        return sourceRevisionId
    }

    return undefined
}

const buildInputStep = (testset?: RunConfigTestset): RunStep | undefined => {
    if (!testset) return undefined
    const inputKey = slugify(testset.name ?? testset.slug ?? "testset", testset.id)

    const references: Record<string, {id: string}> = {
        testset: {id: testset.id},
    }

    if (testset.revisionId) {
        references.testset_revision = {id: testset.revisionId}
    }

    // TODO: after new testsets
    // if (testset.variantId) references.testset_variant = {id: testset.variantId}

    return {
        key: inputKey,
        type: "input",
        origin: "auto",
        references,
    }
}

const buildInvocationStep = (revision: Workflow, inputKey: string): RunStep => {
    const invocationKey = slugify(revision.name ?? "invocation", revision.id)
    const references: Record<string, {id: string}> = {}

    const appId = revision.workflow_id
    if (appId && isValidUUID(appId)) {
        references.application = {id: appId}
    }

    const variantId = revision.workflow_variant_id
    if (variantId && isValidUUID(variantId)) {
        references.application_variant = {id: variantId}
    }
    const invocationRevisionId = resolveWorkflowRevisionId(revision)
    if (invocationRevisionId) {
        references.application_revision = {id: invocationRevisionId}
    }
    return {
        key: invocationKey,
        type: "invocation",
        origin: "human",
        references,
        inputs: [{key: inputKey}],
    }
}

const buildAnnotationStepsFromEvaluators = (
    evaluators: Workflow[] | undefined,
    inputKey: string,
    invocationKey: string,
): RunStep[] => {
    if (!evaluators) return []
    return evaluators.map((evaluator) => {
        const references: Record<string, {id: string}> = {}

        if (evaluator.workflow_id && isValidUUID(evaluator.workflow_id)) {
            references.evaluator = {id: evaluator.workflow_id}
        }

        if (evaluator.workflow_variant_id && isValidUUID(evaluator.workflow_variant_id)) {
            references.evaluator_variant = {id: evaluator.workflow_variant_id}
        }

        const evaluatorRevisionId = resolveWorkflowRevisionId(evaluator)
        if (evaluatorRevisionId) {
            references.evaluator_revision = {id: evaluatorRevisionId}
        }

        return {
            key: `${invocationKey}.${evaluator.slug}`,
            references,
            type: "annotation",
            origin: "human",
            inputs: [{key: inputKey}, {key: invocationKey}],
        }
    })
}

const buildMappings = (
    revision: Workflow,
    correctAnswerColumn: string,
    evaluators: Workflow[] | undefined,
    schemaContext: RevisionSchemaContext,
    testset?: RunConfigTestset,
): RunMapping[] => {
    const testsetKey = testset
        ? slugify(testset.name ?? testset.slug ?? "testset", testset.id)
        : "input"
    const invocationKey = slugify(revision.name ?? "invocation", revision.id)
    const mappings: RunMapping[] = []
    const pushedTestsetColumns = new Set<string>()

    const testsetColumns = testset ? new Set(extractColumnsFromTestset(testset)) : new Set<string>()

    // Input mappings — schema-derived variable names (custom: schema keys;
    // non-custom: keys of the saved input-schema properties). Resolved from the
    // caller-supplied snapshot rather than from jotai atoms.
    {
        const {isCustom, spec, routePath, inputSchemaProperties} = schemaContext

        let variableNames: string[] = []
        if (isCustom) {
            variableNames = spec ? extractInputKeysFromSchema(spec, routePath) : []
        } else {
            variableNames =
                inputSchemaProperties && typeof inputSchemaProperties === "object"
                    ? Object.keys(inputSchemaProperties)
                    : []
        }

        variableNames.forEach((name) => {
            if (!name || typeof name !== "string") return
            if (testsetColumns.size > 0 && !testsetColumns.has(name)) return
            pushedTestsetColumns.add(name)
            mappings.push({
                column: {kind: "testset", name},
                step: {key: testsetKey, path: `data.${name}`},
            })
        })

        const {primaryEndpoint} = spec
            ? extractAllEndpointSchemas(spec, routePath)
            : {primaryEndpoint: null}
        if (
            primaryEndpoint?.messagesSchema &&
            !pushedTestsetColumns.has("messages") &&
            testsetColumns.has("messages")
        ) {
            pushedTestsetColumns.add("messages")
            mappings.push({
                column: {kind: "testset", name: "messages"},
                step: {key: testsetKey, path: "data.inputs.messages"},
            })
        }
    }

    // Remaining testset columns not already added from schema.
    if (testset) {
        const normalizedCorrectAnswer = (correctAnswerColumn || "")
            .replace(/[\W_]/g, "")
            .toLowerCase()
        testsetColumns.forEach((name) => {
            if (!name || typeof name !== "string") return
            const normalized = name.trim()
            if (!normalized || normalized.startsWith("__")) return
            const normalizedSafe = normalized.replace(/[\W_]/g, "").toLowerCase()
            if (normalizedSafe === normalizedCorrectAnswer) return
            if (normalizedSafe.includes("correctanswer")) return
            if (normalizedSafe.startsWith("testcase") || normalizedSafe.includes("dedup")) return
            if (pushedTestsetColumns.has(name) || pushedTestsetColumns.has(normalizedSafe)) return
            pushedTestsetColumns.add(name)
            pushedTestsetColumns.add(normalizedSafe)
            mappings.push({
                column: {kind: "testset", name},
                step: {key: testsetKey, path: `data.${name}`},
            })
        })
    }

    // Application output mapping (canonical "outputs" column to align with backend).
    mappings.push({
        column: {kind: "invocation", name: "outputs"},
        step: {key: invocationKey, path: "attributes.ag.data.outputs"},
    })

    if (testset?.variantId !== undefined) {
        mappings.push({
            column: {kind: "testset", name: "testset_variant_id"},
            step: {key: testsetKey, path: "data.variantId"},
        })
    }

    // Evaluator output mappings, one per metric key.
    if (evaluators && evaluators.length > 0) {
        evaluators.forEach((evaluator) => {
            const metricKeys = extractEvaluatorMetricKeys(evaluator)
            metricKeys.forEach((key) => {
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
 * Build one run configuration per revision. Pure: same input → same output, no atoms.
 */
export const buildRunConfig = ({
    name,
    testset,
    revisions,
    evaluators,
    correctAnswerColumn,
    meta = undefined,
    schemaContextByRevisionId,
}: BuildRunConfigInput): BuildRunConfigResult => {
    const inputStep = buildInputStep(testset)
    const inputKey = testset
        ? slugify(testset.name ?? testset.slug ?? "testset", testset.id)
        : "input"

    const runs = revisions.map((revision) => {
        const invocationKey = slugify(revision.name ?? "invocation", revision.id)
        const schemaContext = schemaContextByRevisionId[revision.id] ?? EMPTY_SCHEMA_CONTEXT

        const steps: RunStep[] = [
            ...(inputStep ? [inputStep] : []),
            buildInvocationStep(revision, inputKey),
            ...buildAnnotationStepsFromEvaluators(evaluators, inputKey, invocationKey),
        ]
        const mappings = buildMappings(
            revision,
            correctAnswerColumn,
            evaluators,
            schemaContext,
            testset,
        )
        return {
            key: `evaluation-${revision.workflow_variant_id ?? revision.id}`,
            name: `${name}`,
            meta,
            data: {steps, mappings},
        }
    })

    return {runs}
}
