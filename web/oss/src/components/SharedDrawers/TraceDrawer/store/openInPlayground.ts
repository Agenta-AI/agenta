import {createBaseRunnable, baseRunnableMolecule} from "@agenta/entities/baseRunnable"
import {loadableController} from "@agenta/entities/runnable"
import {extractAgData, extractInputs, extractOutputs} from "@agenta/entities/trace"
import {playgroundController} from "@agenta/playground"
import {atom} from "jotai"

import type {TraceSpanNode} from "@/oss/services/tracing/types"

import {closeTraceDrawerAtom} from "./traceDrawerStore"

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

const OMIT_KEYS = new Set(["system_prompt", "user_prompt", "input_keys"])

/** Strip omitted keys from each direct child object in parameters */
function stripOmittedKeys(params: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(params)) {
        if (isRecord(value)) {
            const cleaned: Record<string, unknown> = {}
            for (const [k, v] of Object.entries(value)) {
                if (!OMIT_KEYS.has(k)) cleaned[k] = v
            }
            result[key] = cleaned
        } else {
            result[key] = value
        }
    }
    return result
}

/**
 * Reference structure from backend (SimpleTraceReferences):
 * - application: {id, slug, version}
 * - application_variant: {id, slug, version}
 * - application_revision: {id, slug, version}
 * - evaluator: {id, slug, version}
 * - evaluator_variant: {id, slug, version}
 * - evaluator_revision: {id, slug, version}
 */
interface TraceReference {
    id?: string
    slug?: string
    version?: string
}

interface TraceReferences {
    application?: TraceReference
    application_variant?: TraceReference
    application_revision?: TraceReference
    evaluator?: TraceReference
    evaluator_variant?: TraceReference
    evaluator_revision?: TraceReference
}

/**
 * Extract references from ag.references (dict format) or top-level references array
 */
function extractReferences(span: TraceSpanNode): TraceReferences {
    const result: TraceReferences = {}

    // Try ag.references first (dict format from backend)
    const agData = (span.attributes as Record<string, unknown>)?.ag as Record<string, unknown>
    const agRefs = agData?.references as Record<string, TraceReference> | undefined
    if (agRefs) {
        if (agRefs.application) result.application = agRefs.application
        if (agRefs.application_variant) result.application_variant = agRefs.application_variant
        if (agRefs.application_revision) result.application_revision = agRefs.application_revision
        if (agRefs.evaluator) result.evaluator = agRefs.evaluator
        if (agRefs.evaluator_variant) result.evaluator_variant = agRefs.evaluator_variant
        if (agRefs.evaluator_revision) result.evaluator_revision = agRefs.evaluator_revision
    }

    // Also check top-level references array (alternative format)
    const topRefs = span.references as
        | {id?: string; slug?: string; version?: string; attributes?: {key?: string}}[]
        | undefined
    if (topRefs && Array.isArray(topRefs)) {
        for (const ref of topRefs) {
            const key = ref.attributes?.key
            if (!key) continue
            const refData: TraceReference = {id: ref.id, slug: ref.slug, version: ref.version}
            if (key === "application" && !result.application) result.application = refData
            if (key === "application_variant" && !result.application_variant)
                result.application_variant = refData
            if (key === "application_revision" && !result.application_revision)
                result.application_revision = refData
            if (key === "evaluator" && !result.evaluator) result.evaluator = refData
            if (key === "evaluator_variant" && !result.evaluator_variant)
                result.evaluator_variant = refData
            if (key === "evaluator_revision" && !result.evaluator_revision)
                result.evaluator_revision = refData
        }
    }

    return result
}

/**
 * Result from opening a trace in playground.
 * - If `revisionId` is set, the trace has a valid application_revision reference
 *   and the playground should open that existing revision.
 * - If `entityId` is set, a new baseRunnable was created from the trace data.
 */
export interface OpenInPlaygroundResult {
    type: "revision" | "baseRunnable"
    entityId: string
    label: string
    inputs: Record<string, unknown>
}

/**
 * Action atom that opens a trace span in the project-level playground.
 *
 * Flow:
 * 1. Extracts inputs, outputs, and parameters from the span's ag.data
 * 2. Checks for application_revision reference - if present, opens that revision directly
 * 3. Otherwise, creates a local baseRunnable entity from trace data
 * 4. Adds it as the primary playground node
 * 5. Populates the loadable with trace inputs as a testset row
 * 6. Closes the trace drawer
 *
 * Navigation to the playground page is handled by the calling component.
 */
export const openTraceInPlaygroundAtom = atom(
    null,
    (_get, set, activeSpan: TraceSpanNode): OpenInPlaygroundResult => {
        // 1. Extract data from active span
        const agData = extractAgData(activeSpan)
        const rawInputs = extractInputs(activeSpan)
        const outputs = extractOutputs(activeSpan)

        // ag.data.inputs may be a flat map of input keys OR a nested structure
        // with { inputs: {...actual inputs...}, parameters: {...config...} }.
        // Detect the nested shape and split accordingly.
        const hasNestedInputs = isRecord(rawInputs.inputs)
        const actualInputs = hasNestedInputs
            ? (rawInputs.inputs as Record<string, unknown>)
            : rawInputs
        const rawParameters = (
            hasNestedInputs && isRecord(rawInputs.parameters)
                ? rawInputs.parameters
                : (agData?.parameters ?? {})
        ) as Record<string, unknown>

        // Strip keys that duplicate prompt template / input data from nested objects
        const parameters = stripOmittedKeys(rawParameters)

        // 2. Extract references from trace
        const refs = extractReferences(activeSpan)

        // 3. Determine label from references
        const label =
            refs.application_variant?.slug ||
            refs.application?.slug ||
            refs.evaluator_variant?.slug ||
            refs.evaluator?.slug ||
            agData?.variantName ||
            activeSpan.span_name ||
            "Trace Replay"

        // 4. Check if we have a valid revision reference to open directly
        // Note: revision ID may be in `id` or `version` field depending on how it was stored
        const revisionId = refs.application_revision?.id || refs.application_revision?.version
        if (revisionId) {
            // Open existing revision in playground
            set(playgroundController.actions.addPrimaryNode, {
                type: "legacyAppRevision",
                id: revisionId,
                label,
            })

            // Populate loadable with trace inputs
            if (Object.keys(actualInputs).length > 0) {
                const loadableId = `testset:legacyAppRevision:${revisionId}`
                set(loadableController.actions.setRows, loadableId, [
                    {id: "trace-input-0", data: actualInputs},
                ])
            }

            // Close the trace drawer
            set(closeTraceDrawerAtom)

            return {
                type: "revision",
                entityId: revisionId,
                label,
                inputs: actualInputs,
            }
        }

        // 5. No revision reference - create baseRunnable from trace data
        const {id: entityId, data} = createBaseRunnable({
            label,
            inputs: actualInputs,
            outputs,
            parameters,
            sourceRef: refs.application?.id
                ? {
                      type: "application",
                      id: refs.application.id,
                      slug: refs.application.slug,
                  }
                : refs.evaluator?.id
                  ? {
                        type: "evaluator",
                        id: refs.evaluator.id,
                        slug: refs.evaluator.slug,
                    }
                  : undefined,
        })

        // 6. Initialize entity in molecule store
        baseRunnableMolecule.set.data(entityId, data)

        // 7. Add to playground (creates node + loadable + initial empty row)
        set(playgroundController.actions.addPrimaryNode, {
            type: "baseRunnable",
            id: entityId,
            label,
        })

        // 8. Replace empty row with trace inputs if available
        if (Object.keys(actualInputs).length > 0) {
            const loadableId = `testset:baseRunnable:${entityId}`
            set(loadableController.actions.setRows, loadableId, [
                {id: "trace-input-0", data: actualInputs},
            ])
        }

        // 9. Close the trace drawer
        set(closeTraceDrawerAtom)

        return {
            type: "baseRunnable",
            entityId,
            label,
            inputs: actualInputs,
        }
    },
)
