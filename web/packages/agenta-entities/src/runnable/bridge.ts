/**
 * Runnable Bridge Configuration
 *
 * Configures the runnable bridge with available runnable types.
 * This is where molecule integrations are defined.
 *
 * @example
 * ```typescript
 * import { runnableBridge } from '@agenta/entities/runnable'
 *
 * // Use flattened API (preferred)
 * const data = useAtomValue(runnableBridge.data(runnableId))
 * const inputPorts = useAtomValue(runnableBridge.inputPorts(runnableId))
 * const outputPorts = useAtomValue(runnableBridge.outputPorts(runnableId))
 * const config = useAtomValue(runnableBridge.config(runnableId))
 *
 * // Or access runnable-specific features
 * const evaluatorController = runnableBridge.runnable('evaluatorRevision')
 * const presets = useAtomValue(evaluatorController.selectors.presets(evaluatorId))
 * ```
 */

import {getAgentaApiUrl} from "@agenta/shared/api"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"

import type {BaseRunnableData} from "../baseRunnable"
import {baseRunnableMolecule} from "../baseRunnable"
import {evaluatorMolecule} from "../evaluator"
import {
    invocationUrlAtomFamily as evaluatorInvocationUrlAtomFamily,
    requestPayloadAtomFamily as evaluatorRequestPayloadAtomFamily,
} from "../evaluator/state/runnableSetup"
import {evaluatorRevisionMolecule} from "../evaluatorRevision"
import {legacyEvaluatorMolecule} from "../legacyEvaluator"
import {
    invocationUrlAtomFamily as legacyEvaluatorInvocationUrlAtomFamily,
    requestPayloadAtomFamily as legacyEvaluatorRequestPayloadAtomFamily,
} from "../legacyEvaluator/state/runnableSetup"
import {loadableColumnsAtomFamily, loadableStateAtomFamily} from "../loadable/store"
import {createRunnableBridge, type RunnableData, type RunnablePort} from "../shared"
import {workflowMolecule} from "../workflow"
import {archiveWorkflowRevisionAtom, commitWorkflowRevisionAtom} from "../workflow/state/commit"
import {
    executionModeAtomFamily as workflowExecutionModeAtomFamily,
    invocationUrlAtomFamily as workflowInvocationUrlAtomFamily,
    requestPayloadAtomFamily as workflowRequestPayloadAtomFamily,
} from "../workflow/state/runnableSetup"
import {
    createLocalDraftFromWorkflowRevision,
    workflowLatestRevisionIdAtomFamily,
    workflowServerDataSelectorFamily,
} from "../workflow/state/store"

import type {PathItem, RunnableType, TestsetColumn} from "./types"
import {extractVariablesFromConfig} from "./utils"

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Format a key as a human-readable name
 */
function formatKeyAsName(key: string): string {
    return key
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^./, (str) => str.toUpperCase())
}

/**
 * Extract input ports from a JSON schema
 */
function extractInputPortsFromSchema(schema: unknown): RunnablePort[] {
    if (!schema || typeof schema !== "object") return []

    const s = schema as Record<string, unknown>
    const properties = s.properties as Record<string, unknown> | undefined
    const required = (s.required as string[]) || []

    if (!properties) return []

    return Object.entries(properties).map(([key, prop]) => {
        const p = prop as Record<string, unknown>
        return {
            key,
            name: (p.title as string) || formatKeyAsName(key),
            type: (p.type as string) || "string",
            required: required.includes(key),
            schema: prop,
        }
    })
}

/**
 * Extract output ports from a JSON schema
 */
function extractOutputPortsFromSchema(schema: unknown): RunnablePort[] {
    if (!schema || typeof schema !== "object") return []

    const s = schema as Record<string, unknown>

    // Handle simple type schema
    if (s.type && s.type !== "object") {
        return [
            {
                key: "output",
                name: "Output",
                type: s.type as string,
                schema,
            },
        ]
    }

    // Handle object schema
    const properties = s.properties as Record<string, unknown> | undefined
    if (!properties) {
        return [
            {
                key: "output",
                name: "Output",
                type: "unknown",
                schema,
            },
        ]
    }

    return Object.entries(properties).map(([key, prop]) => {
        const p = prop as Record<string, unknown>
        return {
            key,
            name: (p.title as string) || formatKeyAsName(key),
            type: (p.type as string) || "string",
            schema: prop,
        }
    })
}

// ============================================================================
// EVALUATOR (NEW ENTITY) CONFIGURATION
// ============================================================================

/**
 * Evaluator entity from the new preview API (`POST /preview/simple/evaluators/query`).
 * Maps to `Evaluator` type from `@agenta/entities/evaluator`.
 */
interface EvaluatorEntity {
    id: string
    name?: string | null
    slug?: string | null
    version?: number | null
    workflow_id?: string | null
    workflow_variant_id?: string | null
    variant_id?: string | null
    data?: {
        uri?: string | null
        url?: string | null
        parameters?: Record<string, unknown> | null
        schemas?: {
            inputs?: Record<string, unknown> | null
            outputs?: Record<string, unknown> | null
            parameters?: Record<string, unknown> | null
        } | null
    } | null
}

function evaluatorToRunnable(entity: unknown): RunnableData {
    const e = entity as EvaluatorEntity
    return {
        id: e.id,
        name: e.name || e.slug || undefined,
        slug: e.slug || undefined,
        configuration: e.data?.parameters ?? undefined,
        invocationUrl: e.data?.url || undefined,
        uri: e.data?.uri || undefined,
        schemas: {
            inputSchema: e.data?.schemas?.inputs ?? undefined,
            outputSchema: e.data?.schemas?.outputs ?? undefined,
        },
    }
}

function getEvaluatorInputPorts(entity: unknown): RunnablePort[] {
    const e = entity as EvaluatorEntity
    return extractInputPortsFromSchema(e.data?.schemas?.inputs)
}

function getEvaluatorOutputPorts(entity: unknown): RunnablePort[] {
    const e = entity as EvaluatorEntity
    const schemaOutputs = extractOutputPortsFromSchema(e.data?.schemas?.outputs)
    if (schemaOutputs.length > 0) return schemaOutputs

    // Default evaluator output
    return [
        {
            key: "score",
            name: "Score",
            type: "number",
        },
    ]
}

// ============================================================================
// EVALUATOR CONFIG TRANSFORMATION
// ============================================================================

/**
 * Detect if the parameters are evaluator flat config that should be nested.
 * Flat evaluator configs have `prompt_template` + `model` at root, no `prompt`.
 */
function isEvaluatorFlatParams(params: Record<string, unknown> | null | undefined): boolean {
    if (!params) return false
    return (
        !params.prompt && typeof params.model === "string" && Array.isArray(params.prompt_template)
    )
}

/**
 * Transform flat evaluator parameters to nested prompt structure.
 * Aligns evaluator config with app workflow config for consistent UI rendering.
 *
 * FROM: { prompt_template: [...], model: "...", response_type: "...", json_schema: {...}, correct_answer_key: "...", threshold: ..., version: "..." }
 * TO:   { prompt: { messages: [...], llm_config: { model: "..." } }, feedback_config: { type: "...", json_schema: {...} }, advanced_config: {...} }
 *
 * Also handles already-nested data by extracting feedback_config from prompt.llm_config.response_format.
 *
 * Hidden fields (not rendered): version, correct_answer_key, threshold
 * These are stored but not shown in the UI config section.
 */
function nestEvaluatorConfiguration(flat: Record<string, unknown>): Record<string, unknown> {
    // Handle already-nested data: extract feedback_config from prompt.llm_config.response_format
    if (!isEvaluatorFlatParams(flat)) {
        // Check if data is already nested with prompt.llm_config.response_format
        const prompt = flat.prompt as Record<string, unknown> | undefined
        const llmConfig = (prompt?.llm_config ?? prompt?.llmConfig) as
            | Record<string, unknown>
            | undefined
        const responseFormat = llmConfig?.response_format as Record<string, unknown> | undefined

        // If response_format exists in llm_config, move it to top-level feedback_config
        if (responseFormat && !flat.feedback_config) {
            const {response_format: _rf, ...restLlmConfig} = llmConfig as Record<string, unknown>
            return {
                ...flat,
                prompt: {
                    ...prompt,
                    llm_config: restLlmConfig,
                },
                feedback_config: responseFormat,
            }
        }
        return flat
    }

    const {
        prompt_template,
        model,
        response_type,
        json_schema,
        // Hidden fields - stored in __evaluator_meta for persistence but not rendered
        version: _version,
        correct_answer_key: _correctAnswerKey,
        threshold: _threshold,
        ...rest
    } = flat

    // Build feedback_config object if response_type is present
    // This matches the schema structure where feedback_config is a top-level property
    const feedbackConfig: Record<string, unknown> | undefined = response_type
        ? {
              type: response_type,
              ...(json_schema ? {json_schema} : {}),
          }
        : undefined

    const result = {
        prompt: {
            messages: prompt_template,
            llm_config: {
                model,
            },
        },
        // Feedback configuration as a top-level section (matches schema)
        ...(feedbackConfig ? {feedback_config: feedbackConfig} : {}),
        // Store evaluator-specific fields in a named section
        advanced_config: {
            correct_answer_key: _correctAnswerKey,
            threshold: _threshold,
        },
        ...rest,
    }
    return result
}

/**
 * Reverse transform: nested prompt structure back to flat evaluator parameters.
 * Restores hidden fields from advanced_config and extracts feedback_config.
 */

function flattenEvaluatorConfiguration(
    nested: Record<string, unknown>,
    originalFlat: Record<string, unknown> | null,
): Record<string, unknown> {
    const prompt = nested.prompt as Record<string, unknown> | undefined
    if (!prompt || !prompt.messages) return nested

    const llmConfig = (prompt.llm_config ?? prompt.llmConfig) as Record<string, unknown> | undefined

    // Extract feedback_config from top level (new structure)
    const feedbackConfig = nested.feedback_config as Record<string, unknown> | undefined

    // Extract advanced config fields or fall back to originalFlat
    const advancedConfig = nested.advanced_config as Record<string, unknown> | undefined

    // Start with original flat params to preserve all fields, then override with changes
    const result: Record<string, unknown> = {
        ...(originalFlat ?? {}),
        prompt_template: prompt.messages,
        model: llmConfig?.model ?? originalFlat?.model,
    }

    // Extract response_type and json_schema from feedback_config (if provided)
    if (feedbackConfig?.type !== undefined) {
        result.response_type = feedbackConfig.type
    }
    if (feedbackConfig?.json_schema !== undefined) {
        result.json_schema = feedbackConfig.json_schema
    }

    // Override advanced config fields if provided
    if (advancedConfig?.correct_answer_key !== undefined) {
        result.correct_answer_key = advancedConfig.correct_answer_key
    }
    if (advancedConfig?.threshold !== undefined) {
        result.threshold = advancedConfig.threshold
    }

    return result
}

/**
 * Transform flat evaluator parameters schema to nested prompt structure.
 * Aligns evaluator schema with app workflow schema for consistent UI rendering.
 *
 * FROM schema: { properties: { prompt_template: {...}, model: {...}, response_type: {...}, json_schema: {...}, version: {...}, ... } }
 * TO schema:   { properties: { prompt: { properties: { messages: {...}, llm_config: { properties: { model: {...}, response_format: {...} } } } } } }
 *
 * Hidden fields (not in output schema): version, correct_answer_key, threshold
 */
function nestEvaluatorSchema(flatSchema: Record<string, unknown>): Record<string, unknown> {
    const properties = flatSchema.properties as Record<string, unknown> | undefined
    if (!properties || !properties.prompt_template || !properties.model) return flatSchema

    const {
        prompt_template,
        model,
        response_type,
        json_schema,
        // Hidden fields - excluded from top-level schema
        version: _version,
        correct_answer_key,
        threshold,
        ...restProps
    } = properties

    // Build feedback_config schema as a top-level collapsible section
    // Use x-parameter: "feedback_config" to trigger FeedbackConfigurationControl
    const feedbackConfigSchema = response_type
        ? {
              type: "object",
              title: "Feedback Configuration",
              "x-parameter": "feedback_config",
              properties: {
                  type: response_type,
                  ...(json_schema ? {json_schema} : {}),
              },
          }
        : undefined

    // Build advanced_config schema if any of the fields exist
    const hasAdvancedFields = correct_answer_key || threshold
    const advancedConfigSchema = hasAdvancedFields
        ? {
              type: "object",
              title: "Advanced Configuration",
              "x-parameter": "inline", // Render properties inline, not as drill-in
              properties: {
                  ...(correct_answer_key ? {correct_answer_key} : {}),
                  ...(threshold ? {threshold} : {}),
              },
          }
        : undefined

    return {
        ...flatSchema,
        properties: {
            prompt: {
                type: "object",
                title: "Prompt",
                "x-parameter": "prompt",
                properties: {
                    messages: prompt_template,
                    llm_config: {
                        type: "object",
                        title: "LLM Config",
                        properties: {
                            model,
                        },
                    },
                },
            },
            // Feedback Configuration as a top-level collapsible section
            ...(feedbackConfigSchema ? {feedback_config: feedbackConfigSchema} : {}),
            ...(advancedConfigSchema ? {advanced_config: advancedConfigSchema} : {}),
            ...restProps,
        },
    }
}

// ============================================================================
// EVALUATOR REVISION CONFIGURATION
// ============================================================================

/**
 * EvaluatorRevision entity from the workflow revisions API.
 * Same shape as EvaluatorEntity — both are WorkflowRevision objects
 * with `data` containing uri, schemas, parameters.
 *
 * The revision data may also contain legacy fields:
 * - `data.service` — legacy service config
 * - `data.configuration` — legacy parameters (same as `data.parameters`)
 *
 * Configuration is transformed from flat to nested prompt structure for UI alignment
 * with app workflow config rendering (see nestEvaluatorConfiguration).
 */
function evaluatorRevisionToRunnable(entity: unknown): RunnableData {
    const e = entity as EvaluatorEntity
    const flatParams = e.data?.parameters ?? undefined
    return {
        id: e.id,
        name: e.name || e.slug || undefined,
        slug: e.slug || undefined,
        configuration: flatParams ? nestEvaluatorConfiguration(flatParams) : undefined,
        invocationUrl: e.data?.url || undefined,
        uri: e.data?.uri || undefined,
        schemas: {
            inputSchema: e.data?.schemas?.inputs ?? undefined,
            outputSchema: e.data?.schemas?.outputs ?? undefined,
        },
    }
}

function getEvaluatorRevisionInputPorts(entity: unknown): RunnablePort[] {
    return getEvaluatorInputPorts(entity)
}

function getEvaluatorRevisionOutputPorts(entity: unknown): RunnablePort[] {
    return getEvaluatorOutputPorts(entity)
}

/**
 * Invocation URL selector for evaluator revisions.
 * All evaluators (built-in and custom) use the unified
 * `/preview/workflows/invoke` endpoint.
 */
function evaluatorRevisionInvocationUrlSelector(revisionId: string) {
    return atom<string | null>((get) => {
        const entity = get(
            evaluatorRevisionMolecule.selectors.data(revisionId),
        ) as EvaluatorEntity | null
        if (!entity?.data) return null

        // Custom evaluators with webhook URL
        if (entity.data.url) return entity.data.url

        // All URI-based evaluators use the unified workflow invoke endpoint
        if (entity.data.uri) {
            return `${getAgentaApiUrl()}/preview/workflows/invoke`
        }

        return null
    })
}

/**
 * Request payload selector for evaluator revisions.
 * Builds `{interface, configuration, data}` body for the unified
 * `/preview/workflows/invoke` endpoint.
 */
function evaluatorRevisionRequestPayloadSelector(revisionId: string) {
    return atom<Record<string, unknown> | null>((get) => {
        const entity = get(
            evaluatorRevisionMolecule.selectors.data(revisionId),
        ) as EvaluatorEntity | null
        if (!entity?.data) return null

        const uri = entity.data.uri
        const url = entity.data.url
        if (!uri && !url) return null

        const parameters = entity.data.parameters ?? {}
        const evaluatorId = entity.workflow_id ?? undefined
        const evaluatorVariantId = entity.workflow_variant_id ?? entity.variant_id ?? undefined
        const references: Record<string, Record<string, string | undefined>> = {}

        if (evaluatorId) {
            references.evaluator = {id: evaluatorId}
        }
        if (evaluatorVariantId) {
            references.evaluator_variant = {id: evaluatorVariantId}
        }
        if (entity.id || entity.slug || entity.version != null) {
            references.evaluator_revision = {
                id: entity.id || undefined,
                slug: entity.slug ?? undefined,
                version: entity.version != null ? String(entity.version) : undefined,
            }
        }

        return {
            __rawBody: true,
            interface: uri ? {uri} : {url},
            configuration:
                parameters && Object.keys(parameters).length > 0 ? {parameters} : undefined,
            references: Object.keys(references).length > 0 ? references : undefined,
            data: {
                inputs: {},
                outputs: {},
                parameters,
            },
        }
    })
}

/**
 * Reactive input ports selector for evaluator revisions.
 * Reads from the molecule's merged entity data (which includes inspect-resolved schemas).
 */
function evaluatorRevisionInputPortsSelector(revisionId: string) {
    return atom<RunnablePort[]>((get) => {
        const entity = get(
            evaluatorRevisionMolecule.selectors.data(revisionId),
        ) as EvaluatorEntity | null
        return extractInputPortsFromSchema(entity?.data?.schemas?.inputs)
    })
}

/**
 * Reactive output ports selector for evaluator revisions.
 * Reads from the molecule's merged entity data (which includes inspect-resolved schemas).
 * Falls back to a default "score" output if no schema properties are defined.
 */
function evaluatorRevisionOutputPortsSelector(revisionId: string) {
    return atom<RunnablePort[]>((get) => {
        const entity = get(
            evaluatorRevisionMolecule.selectors.data(revisionId),
        ) as EvaluatorEntity | null
        const schemaOutputs = extractOutputPortsFromSchema(entity?.data?.schemas?.outputs)
        if (schemaOutputs.length > 0) return schemaOutputs
        return [{key: "score", name: "Score", type: "number"}]
    })
}

/**
 * Reactive schemas selector for evaluator revisions.
 * Returns the full input/output schemas from the inspect-enriched entity data.
 */
function evaluatorRevisionSchemasSelector(revisionId: string) {
    return atom<{inputSchema?: unknown; outputSchema?: unknown} | null>((get) => {
        const entity = get(
            evaluatorRevisionMolecule.selectors.data(revisionId),
        ) as EvaluatorEntity | null
        if (!entity?.data?.schemas) return null
        return {
            inputSchema: entity.data.schemas.inputs ?? undefined,
            outputSchema: entity.data.schemas.outputs ?? undefined,
        }
    })
}

/**
 * Parameters schema selector for evaluator revisions.
 * Transforms the flat evaluator parameters schema into a nested prompt structure
 * to align with app workflow config rendering.
 */
function evaluatorRevisionParametersSchemaSelector(revisionId: string) {
    return atom<Record<string, unknown> | null>((get) => {
        const entity = get(
            evaluatorRevisionMolecule.selectors.data(revisionId),
        ) as EvaluatorEntity | null
        const flatSchema =
            (entity?.data?.schemas?.parameters as Record<string, unknown> | null) ?? null
        if (!flatSchema) return null
        return nestEvaluatorSchema(flatSchema)
    })
}

// ============================================================================
// WORKFLOW CONFIGURATION
// ============================================================================

/**
 * Workflow entity from the preview API (`POST /preview/workflows/query`).
 * Maps to `Workflow` type from `@agenta/entities/workflow`.
 *
 * Unlike evaluator, workflow supports all flag combinations:
 * is_custom, is_evaluator, is_human, is_chat.
 */
interface WorkflowEntity {
    id: string
    name?: string | null
    slug?: string | null
    version?: number | null
    flags?: {
        is_custom?: boolean
        is_evaluator?: boolean
        is_human?: boolean
        is_chat?: boolean
    } | null
    data?: {
        uri?: string | null
        url?: string | null
        parameters?: Record<string, unknown> | null
        configuration?: Record<string, unknown> | null
        schemas?: {
            inputs?: Record<string, unknown> | null
            outputs?: Record<string, unknown> | null
            parameters?: Record<string, unknown> | null
        } | null
    } | null
}

function workflowToRunnable(entity: unknown): RunnableData {
    const e = entity as WorkflowEntity
    const flatParams = e.data?.parameters ?? e.data?.configuration ?? undefined

    // Check if this is an evaluator workflow.
    // Only use the flags — the URI prefix "agenta:builtin:" is shared by both
    // evaluator builtins (auto_exact_match, etc.) and app builtins (completion, chat).
    const isEvaluator = !!e.flags?.is_evaluator

    // Transform evaluator config to nested prompt structure
    const configuration =
        isEvaluator && flatParams
            ? nestEvaluatorConfiguration(flatParams as Record<string, unknown>)
            : flatParams

    return {
        id: e.id,
        name: e.name || e.slug || undefined,
        slug: e.slug || undefined,
        version: e.version ?? undefined,
        configuration,
        invocationUrl: e.data?.url || undefined,
        uri: e.data?.uri || undefined,
        schemas: {
            inputSchema: e.data?.schemas?.inputs ?? undefined,
            outputSchema: e.data?.schemas?.outputs ?? undefined,
        },
    } as RunnableData
}

function getWorkflowInputPorts(entity: unknown): RunnablePort[] {
    const e = entity as WorkflowEntity
    const schemaPorts = extractInputPortsFromSchema(e.data?.schemas?.inputs)
    if (schemaPorts.length > 0) return schemaPorts

    // Fallback: derive input variables from prompt templates in parameters
    const params = e.data?.parameters ?? e.data?.configuration
    if (params) {
        const vars = extractVariablesFromConfig(params as Record<string, unknown>)
        if (vars.length > 0) {
            return vars.map((key) => ({key, name: key, type: "string", required: true}))
        }
    }
    return []
}

function getWorkflowOutputPorts(entity: unknown): RunnablePort[] {
    const e = entity as WorkflowEntity
    const schemaOutputs = extractOutputPortsFromSchema(e.data?.schemas?.outputs)
    if (schemaOutputs.length > 0) return schemaOutputs

    // Evaluator-type workflows default to score/number (same as evaluator entities)
    if (e.flags?.is_evaluator) {
        return [{key: "score", name: "Score", type: "number"}]
    }

    // Default output for app workflows
    return [
        {
            key: "output",
            name: "Output",
            type: "string",
        },
    ]
}

/**
 * Reactive input ports selector for workflows.
 */
function workflowInputPortsSelector(workflowId: string) {
    return atom<RunnablePort[]>((get) => {
        const entity = get(workflowMolecule.selectors.data(workflowId)) as WorkflowEntity | null
        if (!entity) return []

        const schemaPorts = extractInputPortsFromSchema(entity.data?.schemas?.inputs)
        if (schemaPorts.length > 0) return schemaPorts

        // Fallback: derive input variables from prompt templates in parameters
        const params = entity.data?.parameters ?? entity.data?.configuration
        if (params) {
            const vars = extractVariablesFromConfig(params as Record<string, unknown>)
            if (vars.length > 0) {
                return vars.map((key) => ({key, name: key, type: "string", required: true}))
            }
        }
        return []
    })
}

/**
 * Reactive output ports selector for workflows.
 */
function workflowOutputPortsSelector(workflowId: string) {
    return atom<RunnablePort[]>((get) => {
        const entity = get(workflowMolecule.selectors.data(workflowId)) as WorkflowEntity | null
        const schemaOutputs = extractOutputPortsFromSchema(entity?.data?.schemas?.outputs)
        if (schemaOutputs.length > 0) return schemaOutputs

        // Evaluator-type workflows default to score/number
        if (entity?.flags?.is_evaluator) {
            return [{key: "score", name: "Score", type: "number"}]
        }
        return [{key: "output", name: "Output", type: "string"}]
    })
}

/**
 * Reactive schemas selector for workflows.
 */
function workflowSchemasSelector(workflowId: string) {
    return atom<{inputSchema?: unknown; outputSchema?: unknown} | null>((get) => {
        const entity = get(workflowMolecule.selectors.data(workflowId)) as WorkflowEntity | null
        if (!entity?.data?.schemas) {
            return {}
        }
        return {
            inputSchema: entity.data.schemas.inputs ?? undefined,
            outputSchema: entity.data.schemas.outputs ?? undefined,
        }
    })
}

/**
 * Reactive parameters schema selector for workflows.
 * Returns the JSON schema that describes the configuration form (prompt, LLM config, etc.).
 *
 * For evaluator workflows (is_evaluator flag or builtin URI), applies nestEvaluatorSchema
 * to transform flat evaluator parameters into nested prompt structure for consistent UI.
 */
function workflowParametersSchemaSelector(workflowId: string) {
    return atom<Record<string, unknown> | null>((get) => {
        const entity = get(workflowMolecule.selectors.data(workflowId)) as WorkflowEntity | null
        const flatSchema =
            (entity?.data?.schemas?.parameters as Record<string, unknown> | null) ?? null
        if (!flatSchema) return null

        // Check if this is an evaluator workflow.
        // Only use the flags — the URI prefix "agenta:builtin:" is shared by both
        // evaluator builtins and app builtins (completion, chat).
        const isEvaluator = !!entity?.flags?.is_evaluator

        if (isEvaluator) {
            const nested = nestEvaluatorSchema(flatSchema) as Record<string, unknown>
            return nested
        }

        return flatSchema
    })
}

// ============================================================================
// SERVER DATA SELECTORS (for commit diff generation)
// ============================================================================

/**
 * Server data selector for workflows.
 * Returns the raw entity data before draft overlay — used as the "original"
 * baseline for commit diff comparisons.
 *
 * Delegates to `workflowServerDataSelectorFamily` which redirects local
 * draft IDs to the source entity's live server data automatically.
 */
function workflowServerDataSelector(workflowId: string) {
    return atom<WorkflowEntity | null>((get) => {
        return get(workflowServerDataSelectorFamily(workflowId)) as WorkflowEntity | null
    })
}

// ============================================================================
// BASE RUNNABLE HELPERS
// ============================================================================

function baseRunnableToRunnable(entity: unknown): RunnableData {
    const data = entity as BaseRunnableData | null
    if (!data) return {id: ""}
    return {
        id: data.id,
        name: data.label,
        configuration: data.parameters,
    }
}

function getBaseRunnableInputPorts(entity: unknown): RunnablePort[] {
    const data = entity as BaseRunnableData | null
    if (!data) return []
    if (data.inputs) {
        return Object.keys(data.inputs).map((key) => ({
            key,
            name: key,
            type: "string",
        }))
    }
    return []
}

function getBaseRunnableOutputPorts(entity: unknown): RunnablePort[] {
    const data = entity as BaseRunnableData | null
    if (!data?.outputs || typeof data.outputs !== "object") return []
    return Object.keys(data.outputs as Record<string, unknown>).map((key) => ({
        key,
        name: key,
        type: "string",
    }))
}

// ============================================================================
// CONFIGURED BRIDGE
// ============================================================================

/**
 * Runnable bridge configured with available runnable types
 *
 * Currently supports:
 * - **workflow**: Generic workflow via workflowMolecule (supports all flag combinations)
 * - **evaluator**: New evaluator entity via evaluatorMolecule
 * - **legacyEvaluator**: Legacy evaluator via legacyEvaluatorMolecule
 * - **evaluatorRevision**: Evaluator revision via evaluatorRevisionMolecule (stub in OSS)
 * - **baseRunnable**: Local-only runnable from span/trace data via baseRunnableMolecule
 */
export const runnableBridge = createRunnableBridge({
    runnables: {
        evaluator: {
            molecule: evaluatorMolecule,
            toRunnable: evaluatorToRunnable,
            getInputPorts: getEvaluatorInputPorts,
            getOutputPorts: getEvaluatorOutputPorts,
            executionModeSelector: () => atom<"chat" | "completion">("completion"),
            invocationUrlSelector: (id: string) => evaluatorInvocationUrlAtomFamily(id),
            requestPayloadSelector: (id: string) => evaluatorRequestPayloadAtomFamily(id),
        },
        legacyEvaluator: {
            molecule: legacyEvaluatorMolecule,
            toRunnable: evaluatorToRunnable,
            getInputPorts: getEvaluatorInputPorts,
            getOutputPorts: getEvaluatorOutputPorts,
            executionModeSelector: () => atom<"chat" | "completion">("completion"),
            invocationUrlSelector: (id: string) => legacyEvaluatorInvocationUrlAtomFamily(id),
            requestPayloadSelector: (id: string) => legacyEvaluatorRequestPayloadAtomFamily(id),
            normalizeResponse: (responseData: unknown) => {
                // Workflow invoke returns { data: { outputs: {...} }, status: {...}, ... }
                const data = responseData as Record<string, unknown> | null | undefined
                const nestedData = data?.data as Record<string, unknown> | undefined
                const output = nestedData?.outputs ?? data?.outputs ?? data
                return {
                    output,
                    trace: data?.trace_id
                        ? {
                              id: data.trace_id as string,
                              ...(data?.span_id ? {spanId: data.span_id as string} : {}),
                          }
                        : undefined,
                }
            },
        },
        evaluatorRevision: {
            molecule: evaluatorRevisionMolecule,
            toRunnable: evaluatorRevisionToRunnable,
            getInputPorts: getEvaluatorRevisionInputPorts,
            getOutputPorts: getEvaluatorRevisionOutputPorts,
            schemasSelector: evaluatorRevisionSchemasSelector,
            parametersSchemaSelector: evaluatorRevisionParametersSchemaSelector,
            inputPortsSelector: evaluatorRevisionInputPortsSelector,
            outputPortsSelector: evaluatorRevisionOutputPortsSelector,
            executionModeSelector: () => atom<"chat" | "completion">("completion"),
            invocationUrlSelector: evaluatorRevisionInvocationUrlSelector,
            requestPayloadSelector: evaluatorRevisionRequestPayloadSelector,
            updateTransform: (entityId, params, get) => {
                const entity = get(
                    evaluatorRevisionMolecule.selectors.data(entityId) as never,
                ) as EvaluatorEntity | null
                const originalFlat =
                    (entity?.data?.parameters as Record<string, unknown> | null) ?? null
                return flattenEvaluatorConfiguration(params, originalFlat)
            },
            normalizeResponse: (responseData: unknown) => {
                // Evaluator endpoint returns {outputs: {score, reasoning, ...}}.
                // Preserve trace metadata when the backend provides it.
                const data = responseData as Record<string, unknown> | null | undefined
                const output = data?.outputs ?? data
                return {
                    output,
                    trace: data?.trace_id
                        ? {
                              id: data.trace_id as string,
                              ...(data?.span_id ? {spanId: data.span_id as string} : {}),
                          }
                        : undefined,
                }
            },
            extraSelectors: {
                presets: (id: string) => evaluatorRevisionMolecule.selectors.presets(id),
            },
            extraActions: {
                applyPreset: evaluatorRevisionMolecule.actions.applyPreset,
            },
        },
        workflow: {
            molecule: workflowMolecule,
            toRunnable: workflowToRunnable,
            getInputPorts: getWorkflowInputPorts,
            getOutputPorts: getWorkflowOutputPorts,
            schemasSelector: workflowSchemasSelector,
            parametersSchemaSelector: workflowParametersSchemaSelector,
            draftSelector: (id: string) => workflowMolecule.atoms.draft(id),
            invalidateCache: () => workflowMolecule.cache.invalidateList(),
            serverDataSelector: workflowServerDataSelector,
            inputPortsSelector: workflowInputPortsSelector,
            outputPortsSelector: workflowOutputPortsSelector,
            executionModeSelector: (id: string) => workflowExecutionModeAtomFamily(id),
            invocationUrlSelector: (id: string) => workflowInvocationUrlAtomFamily(id),
            requestPayloadSelector: (id: string) => workflowRequestPayloadAtomFamily(id),
            updateTransform: (entityId, params, get) => {
                // For evaluator workflows, flatten nested config back to flat format
                // IMPORTANT: Use pure server data, NOT merged entity data
                // Using merged data causes flaky isDirty because originalFlat would include draft changes
                // workflowServerDataSelectorFamily redirects local drafts to source's server data.
                const serverData = get(
                    workflowServerDataSelectorFamily(entityId),
                ) as WorkflowEntity | null
                const isEvaluator = serverData?.flags?.is_evaluator ?? false
                if (isEvaluator) {
                    // Use PURE server params, not merged entity params
                    const originalFlat =
                        (serverData?.data?.parameters as Record<string, unknown> | null) ?? null
                    return flattenEvaluatorConfiguration(params, originalFlat)
                }
                return params
            },
            normalizeResponse: (responseData: unknown) => {
                // Workflow invoke returns either:
                // - v3 format: { version: "3.0", data: "plain text", tree: {...} }
                // - legacy: { data: { outputs: {...} }, status: {...} }
                const data = responseData as Record<string, unknown> | null | undefined
                const nestedData = data?.data
                // v3: data.data is a string (the plain output text)
                if (typeof nestedData === "string") {
                    return {
                        output: nestedData,
                        trace:
                            data?.trace_id || data?.tree_id
                                ? {
                                      id: (data?.trace_id || data?.tree_id) as string,
                                      ...(data?.span_id ? {spanId: data.span_id as string} : {}),
                                  }
                                : undefined,
                    }
                }
                // Legacy: data.data is an object with .outputs
                const nestedObj = nestedData as Record<string, unknown> | undefined
                const output = nestedObj?.outputs ?? data?.outputs ?? data
                return {
                    output,
                    trace: data?.trace_id
                        ? {
                              id: data.trace_id as string,
                              ...(data?.span_id ? {spanId: data.span_id as string} : {}),
                          }
                        : undefined,
                }
            },
            latestRevisionIdSelector: (parentId: string) =>
                workflowLatestRevisionIdAtomFamily(parentId),
            parentIdExtractor: (entity: unknown) => {
                const e = entity as {workflow_id?: string | null}
                return e.workflow_id ?? null
            },
            createLocalDraft: createLocalDraftFromWorkflowRevision,
        },
        baseRunnable: {
            molecule: baseRunnableMolecule,
            toRunnable: baseRunnableToRunnable,
            getInputPorts: getBaseRunnableInputPorts,
            getOutputPorts: getBaseRunnableOutputPorts,
            inputPortsSelector: (id: string) => baseRunnableMolecule.selectors.inputPorts(id),
            outputPortsSelector: (id: string) => baseRunnableMolecule.selectors.outputPorts(id),
            executionModeSelector: (id: string) =>
                atom<"chat" | "completion">((get) =>
                    get(baseRunnableMolecule.selectors.isChatVariant(id)) ? "chat" : "completion",
                ),
            requestPayloadSelector: (id: string) => baseRunnableMolecule.atoms.requestPayload(id),
        },
    },
    crud: {
        createVariant: atom(null, async () => {
            throw new Error("createVariant not supported for workflow entities")
        }),
        commitRevision: commitWorkflowRevisionAtom,
        deleteRevision: archiveWorkflowRevisionAtom,
    },
})

// ============================================================================
// LOADABLE-RUNNABLE INTEGRATION
// ============================================================================

/**
 * Derived columns atom that reads from the linked runnable's inputPorts.
 *
 * When a loadable is linked to a runnable, this atom:
 * 1. Gets the linked runnable info from loadable state
 * 2. Reads the runnable's inputPorts (single source of truth)
 * 3. Returns columns derived from inputPorts
 *
 * This enables reactive updates - when user edits {{newVar}} in prompt,
 * the columns automatically update without any React effects.
 *
 * For workflow: Reads from workflow entity's input schema
 * For evaluator/legacyEvaluator/evaluatorRevision: Reads from evaluator schema
 */
export const loadableColumnsFromRunnableAtomFamily = atomFamily((loadableId: string) =>
    atom<TestsetColumn[]>((get) => {
        const loadableState = get(loadableStateAtomFamily(loadableId))
        const {linkedRunnableType, linkedRunnableId} = loadableState

        // If not linked to a runnable, return stored columns
        if (!linkedRunnableType || !linkedRunnableId) {
            return get(loadableColumnsAtomFamily(loadableId))
        }

        // Get columns from linked runnable's inputPorts
        if (
            linkedRunnableType === "evaluator" ||
            linkedRunnableType === "legacyEvaluator" ||
            linkedRunnableType === "evaluatorRevision"
        ) {
            // Read from evaluator entity's schema
            const entityData = (
                linkedRunnableType === "legacyEvaluator"
                    ? get(legacyEvaluatorMolecule.selectors.data(linkedRunnableId))
                    : get(evaluatorMolecule.selectors.data(linkedRunnableId))
            ) as Record<string, unknown> | null
            if (entityData) {
                const data = (entityData as {data?: Record<string, unknown>}).data
                const schemas = data?.schemas as Record<string, unknown> | undefined
                const inputSchema = schemas?.inputs as Record<string, unknown> | undefined
                if (inputSchema?.properties) {
                    const inputKeys = Object.keys(inputSchema.properties as Record<string, unknown>)
                    if (inputKeys.length > 0) {
                        return inputKeys.map((key) => ({
                            key,
                            name: key,
                            type: "string" as const,
                        }))
                    }
                }
            }
            // Fall back to stub molecule for backward compat
            if (linkedRunnableType === "evaluatorRevision") {
                const stubData = get(
                    evaluatorRevisionMolecule.selectors.data(linkedRunnableId),
                ) as Record<string, unknown> | null
                if (stubData) {
                    const schemas = stubData.schemas as Record<string, unknown> | undefined
                    const inputSchema = schemas?.inputs as Record<string, unknown> | undefined
                    if (inputSchema?.properties) {
                        const inputKeys = Object.keys(
                            inputSchema.properties as Record<string, unknown>,
                        )
                        if (inputKeys.length > 0) {
                            return inputKeys.map((key) => ({
                                key,
                                name: key,
                                type: "string" as const,
                            }))
                        }
                    }
                }
            }
        } else if (linkedRunnableType === "workflow") {
            // Read from workflow entity's schema
            const entityData = get(workflowMolecule.selectors.data(linkedRunnableId)) as Record<
                string,
                unknown
            > | null
            if (entityData) {
                const data = (entityData as {data?: Record<string, unknown>}).data
                const schemas = data?.schemas as Record<string, unknown> | undefined
                const inputSchema = schemas?.inputs as Record<string, unknown> | undefined
                if (inputSchema?.properties) {
                    const inputKeys = Object.keys(inputSchema.properties as Record<string, unknown>)
                    if (inputKeys.length > 0) {
                        return inputKeys.map((key) => ({
                            key,
                            name: key,
                            type: "string" as const,
                        }))
                    }
                }
                // Fallback: derive from prompt template variables
                const params = data?.parameters ?? data?.configuration
                if (params) {
                    const vars = extractVariablesFromConfig(params as Record<string, unknown>)
                    if (vars.length > 0) {
                        return vars.map((key) => ({
                            key,
                            name: key,
                            type: "string" as const,
                        }))
                    }
                }
            }
        } else if (linkedRunnableType === "baseRunnable") {
            // Read from baseRunnable molecule's inputPorts (derived from template vars or trace inputs)
            const inputPorts = get(baseRunnableMolecule.selectors.inputPorts(linkedRunnableId))
            if (inputPorts.length > 0) {
                return inputPorts.map((port) => ({
                    key: port.key,
                    name: port.name,
                    type: "string" as const,
                }))
            }
        }

        // Fall back to stored columns if no inputPorts found
        return get(loadableColumnsAtomFamily(loadableId))
    }),
)

// ============================================================================
// DRILL-IN NAVIGATION
// ============================================================================

/** Data type for getRunnableRootItems */
interface RunnableDataForRootItems {
    configuration?: Record<string, unknown>
}

/**
 * Get root items for DrillIn navigation based on runnable type
 *
 * Generates PathItems from the runnable's configuration for use in
 * DrillIn navigation UI components (ConfigurationSection).
 */
export function getRunnableRootItems(
    _type: RunnableType,
    data: RunnableDataForRootItems | null,
): PathItem[] {
    if (!data) return []

    const items: PathItem[] = []
    const configuration = data.configuration

    if (configuration) {
        // Generate items from configuration keys
        for (const [key, value] of Object.entries(configuration)) {
            // Skip internal fields
            if (key === "version" || key.startsWith("_")) continue

            items.push({
                key,
                name: formatKeyAsName(key),
                value,
            })
        }
    }

    return items
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

export {extractInputPortsFromSchema, extractOutputPortsFromSchema, formatKeyAsName}
