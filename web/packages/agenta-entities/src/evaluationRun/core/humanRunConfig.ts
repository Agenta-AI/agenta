/**
 * Human evaluation run config.
 *
 * Builds the `POST /evaluations/runs/` body for a human evaluation: an input
 * step (the test set), an invocation step (the app) and one annotation step per
 * evaluator, plus the mappings that tell the details page where each column
 * lives. The function is pure. The caller reads the inputs from the stores.
 *
 * Each annotation step key is `${invocationKey}.${evaluator.slug}`, so the
 * slug of every evaluator must be known and unique.
 *
 * @packageDocumentation
 */

import {slugifyBase} from "@agenta/shared/utils"

import {isValidUUID} from "../../shared/utils/revisionUtils"
import {resolveOutputSchemaProperties} from "../../workflow/core/schema"

export interface HumanRunTestset {
    id: string
    name: string
    revisionId?: string | null
    /** Column names of the test set revision. */
    columns: readonly string[]
}

export interface HumanRunApp {
    /** Revision id of the app. */
    id: string
    name?: string | null
    workflowId?: string | null
    variantId?: string | null
}

export interface HumanRunEvaluator {
    revisionId: string
    workflowId?: string | null
    variantId?: string | null
    slug: string
    /** Metric keys the evaluator outputs. See `evaluatorOutputKeys`. */
    outputKeys: readonly string[]
}

export interface BuildHumanRunConfigInput {
    name: string
    testset: HumanRunTestset
    revision: HumanRunApp
    /** Input variable names of the app. */
    inputKeys: readonly string[]
    /** True when the app takes a chat `messages` input. */
    hasMessagesInput: boolean
    evaluators: readonly HumanRunEvaluator[]
}

type StepReferences = Record<string, {id: string}>

export interface HumanRunStep {
    key: string
    type: "input" | "invocation" | "annotation"
    origin: "auto" | "human"
    references: StepReferences
    inputs?: {key: string}[]
}

export interface HumanRunMapping {
    column: {kind: "testset" | "invocation" | "evaluator"; name: string}
    step: {key: string; path: string}
}

export interface HumanRunSpec {
    key: string
    name: string
    meta: {evaluation_kind: "human"}
    data: {steps: HumanRunStep[]; mappings: HumanRunMapping[]}
}

/** Same key the backend builds: a clean name plus the last 12 characters of the id. */
const slugify = (name: string, id: string): string => `${slugifyBase(name)}-${id.slice(-12)}`

const buildReferences = (
    entries: [key: string, id: string | null | undefined][],
): StepReferences => {
    const references: StepReferences = {}
    for (const [key, id] of entries) {
        if (id && isValidUUID(id)) references[key] = {id}
    }
    return references
}

const normalizeColumnName = (name: string) => name.replace(/[\W_]/g, "").toLowerCase()

/** Columns the app does not read: ground truth, test case ids and dedup markers. */
const isSkippedColumn = (name: string) => {
    const normalized = normalizeColumnName(name)
    return (
        name.startsWith("__") ||
        normalized.includes("correctanswer") ||
        normalized.startsWith("testcase") ||
        normalized.includes("dedup")
    )
}

const buildMappings = ({
    testset,
    inputKeys,
    hasMessagesInput,
    evaluators,
    inputKey,
    invocationKey,
}: BuildHumanRunConfigInput & {inputKey: string; invocationKey: string}): HumanRunMapping[] => {
    const mappings: HumanRunMapping[] = []
    const columns = new Set(testset.columns)
    const mapped = new Set<string>()

    const mapTestsetColumn = (name: string, path = `data.${name}`) => {
        mapped.add(name)
        mappings.push({column: {kind: "testset", name}, step: {key: inputKey, path}})
    }

    for (const name of inputKeys) {
        if (name && columns.has(name)) mapTestsetColumn(name)
    }
    if (hasMessagesInput && !mapped.has("messages") && columns.has("messages")) {
        mapTestsetColumn("messages", "data.inputs.messages")
    }
    for (const name of columns) {
        if (!name.trim() || isSkippedColumn(name)) continue
        if (mapped.has(name) || mapped.has(normalizeColumnName(name))) continue
        mapTestsetColumn(name)
        mapped.add(normalizeColumnName(name))
    }

    mappings.push({
        column: {kind: "invocation", name: "outputs"},
        step: {key: invocationKey, path: "attributes.ag.data.outputs"},
    })

    for (const evaluator of evaluators) {
        for (const outputKey of evaluator.outputKeys) {
            mappings.push({
                column: {kind: "evaluator", name: `${evaluator.slug}.${outputKey}`},
                step: {
                    key: `${invocationKey}.${evaluator.slug}`,
                    path: `data.outputs.${outputKey}`,
                },
            })
        }
    }

    return mappings
}

/**
 * Build the body of `POST /evaluations/runs/` for one human evaluation.
 *
 * Throws when an evaluator has no slug or two evaluators share a slug, because
 * the annotation step keys would clash.
 */
export function buildHumanRunConfig(input: BuildHumanRunConfigInput): {runs: [HumanRunSpec]} {
    const {name, testset, revision, evaluators} = input

    const slugs = new Set<string>()
    for (const evaluator of evaluators) {
        if (!evaluator.slug) throw new Error("Every evaluator needs a slug.")
        if (slugs.has(evaluator.slug)) {
            throw new Error(`Two evaluators share the slug "${evaluator.slug}".`)
        }
        slugs.add(evaluator.slug)
    }

    const inputKey = slugify(testset.name, testset.id)
    const invocationKey = slugify(revision.name ?? "invocation", revision.id)

    const inputStep: HumanRunStep = {
        key: inputKey,
        type: "input",
        origin: "auto",
        references: buildReferences([
            ["testset", testset.id],
            ["testset_revision", testset.revisionId],
        ]),
    }
    const invocationStep: HumanRunStep = {
        key: invocationKey,
        type: "invocation",
        origin: "human",
        references: buildReferences([
            ["application", revision.workflowId],
            ["application_variant", revision.variantId],
            ["application_revision", revision.id],
        ]),
        inputs: [{key: inputKey}],
    }
    const annotationSteps: HumanRunStep[] = evaluators.map((evaluator) => ({
        key: `${invocationKey}.${evaluator.slug}`,
        type: "annotation",
        origin: "human",
        references: buildReferences([
            ["evaluator", evaluator.workflowId],
            ["evaluator_variant", evaluator.variantId],
            ["evaluator_revision", evaluator.revisionId],
        ]),
        inputs: [{key: inputKey}, {key: invocationKey}],
    }))

    return {
        runs: [
            {
                key: `evaluation-${revision.variantId ?? revision.id}`,
                name,
                meta: {evaluation_kind: "human"},
                data: {
                    steps: [inputStep, invocationStep, ...annotationSteps],
                    mappings: buildMappings({...input, inputKey, invocationKey}),
                },
            },
        ],
    }
}

const METRIC_TYPES = new Set(["number", "float", "boolean", "string", "class", "array"])

/**
 * Metric keys an evaluator outputs, read from its output schema. Nested objects
 * become dotted keys (`a.b`). Types the annotation form cannot show are left out.
 */
export function evaluatorOutputKeys(evaluatorData: Record<string, unknown> | null | undefined) {
    const keys: string[] = []

    const collect = (schema: Record<string, unknown>, prefix?: string) => {
        for (const [key, raw] of Object.entries(schema)) {
            if (!raw || typeof raw !== "object") continue
            const anyOf = (raw as {anyOf?: unknown[]}).anyOf
            const property = (anyOf?.length ? anyOf[0] : raw) as {
                type?: string | string[]
                properties?: Record<string, unknown>
            }
            const qualifiedKey = prefix ? `${prefix}.${key}` : key
            const type = Array.isArray(property.type)
                ? "string"
                : property.type === "integer"
                  ? "number"
                  : property.type

            if (
                type === "object" &&
                property.properties &&
                typeof property.properties === "object"
            ) {
                collect(property.properties, qualifiedKey)
            } else if (type && METRIC_TYPES.has(type)) {
                keys.push(qualifiedKey)
            }
        }
    }

    collect(resolveOutputSchemaProperties(evaluatorData) ?? {})
    return keys
}
