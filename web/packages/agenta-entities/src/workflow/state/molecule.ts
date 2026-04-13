/**
 * Workflow Molecule
 *
 * Unified API for workflow entity state management.
 * Follows the molecule pattern for consistency with other entities
 * (appRevision, evaluator, testset, etc.).
 *
 * Exposes:
 * - **Raw flag selectors** — mirrors all backend `WorkflowFlags` fields
 *   (URI-derived, interface-derived, user-defined role)
 * - **Derived capability selectors** — semantic questions like `canRun`,
 *   `canDeploy`, `needsUrl`, `workflowType`
 * - **Runnable selectors** — execution mode, invocation URL, request payload
 *
 * @example
 * ```typescript
 * import { workflowMolecule } from '@agenta/entities/workflow'
 *
 * // Raw flags
 * const isChat = useAtomValue(workflowMolecule.selectors.isChat(id))
 * const isLlm = useAtomValue(workflowMolecule.selectors.isLlm(id))
 *
 * // Derived capabilities
 * const canRun = useAtomValue(workflowMolecule.selectors.canRun(id))
 * const type = useAtomValue(workflowMolecule.selectors.workflowType(id))
 *
 * // Imperative API (outside React)
 * const canDeploy = workflowMolecule.get.canDeploy(id)
 * workflowMolecule.set.update(id, { data: { parameters: newParams } })
 * ```
 *
 * @packageDocumentation
 */

import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"

import {
    nestEvaluatorConfiguration,
    flattenEvaluatorConfiguration,
} from "../../runnable/evaluatorTransforms"
import {
    extractInputPortsFromSchema,
    extractOutputPortsFromSchema,
    extractSystemFieldNames,
    formatKeyAsName,
} from "../../runnable/portHelpers"
import {normalizeWorkflowResponse} from "../../runnable/responseHelpers"
import {extractVariablesFromConfig} from "../../runnable/utils"
import type {RunnablePort, StoreOptions} from "../../shared"
import {isLocalDraftId, isPlaceholderId} from "../../shared"
import type {Workflow} from "../core"
import {
    toEvaluatorDefinitionFromWorkflow,
    type EvaluatorDefinition,
} from "../core/evaluatorResolution"
import {
    parseWorkflowKeyFromUri,
    resolveInputSchema,
    resolveOutputSchema,
    resolveParameters,
    resolveParametersSchema,
} from "../core/schema"

import {workflowsListDataAtom, nonArchivedWorkflowsAtom} from "./allWorkflows"
import {evaluatorTemplatesDataAtom} from "./evaluatorUtils"
import {
    executionModeAtomFamily as runnableExecutionModeAtomFamily,
    invocationUrlAtomFamily as runnableInvocationUrlAtomFamily,
    deploymentUrlAtomFamily as runnableDeploymentUrlAtomFamily,
    requestPayloadAtomFamily as runnableRequestPayloadAtomFamily,
} from "./runnableSetup"
import {
    workflowProjectIdAtom,
    appWorkflowsListQueryAtom,
    workflowQueryAtomFamily,
    workflowInspectAtomFamily,
    workflowAppSchemaAtomFamily,
    workflowInterfaceSchemasAtomFamily,
    workflowDraftAtomFamily,
    workflowBaseEntityAtomFamily,
    workflowEntityAtomFamily,
    workflowLocalServerDataAtomFamily,
    workflowIsDirtyAtomFamily,
    getFlatSourceData,
    workflowIsEphemeralAtomFamily,
    workflowServerDataSelectorFamily,
    updateWorkflowDraftAtom,
    discardWorkflowDraftAtom,
    invalidateWorkflowsListCache,
    invalidateWorkflowCache,
    agTypeSchemaAtomFamily,
} from "./store"

// ============================================================================
// HELPERS
// ============================================================================

function getStore(options?: StoreOptions) {
    return options?.store ?? getDefaultStore()
}

// ============================================================================
// DERIVED SELECTORS
// ============================================================================

/**
 * Workflow data selector (returns merged server + draft data).
 */
const dataAtomFamily = atomFamily((workflowId: string) =>
    atom<Workflow | null>((get) => get(workflowBaseEntityAtomFamily(workflowId))),
)

/**
 * Resolved workflow data selector (returns merged server + draft + schema-resolved data).
 * Unlike `dataAtomFamily` which reads from the base entity (no inspect/OpenAPI),
 * this reads from the full `workflowEntityAtomFamily` which includes schema resolution.
 * Use this when you need schemas to be resolved (e.g., for UI rendering of schema-dependent content).
 */
const resolvedDataAtomFamily = atomFamily((workflowId: string) =>
    atom<Workflow | null>((get) => get(workflowEntityAtomFamily(workflowId))),
)

/**
 * Workflow query state selector (loading, error states).
 *
 * Local draft IDs and hydration placeholders are client-only entities whose
 * server query is disabled. For those, surface locally-seeded data with
 * isPending: false so downstream consumers (e.g. config section) don't show
 * infinite loading skeletons.
 */
const queryAtomFamily = atomFamily((workflowId: string) =>
    atom((get) => {
        if (isLocalDraftId(workflowId) || isPlaceholderId(workflowId)) {
            const localData = get(workflowLocalServerDataAtomFamily(workflowId))
            return {
                data: localData ?? null,
                isPending: false,
                isError: false,
                error: null,
            }
        }
        const query = get(workflowQueryAtomFamily(workflowId))
        return {
            data: query.data ?? null,
            isPending: query.isPending,
            isError: query.isError,
            error: query.error ?? null,
        }
    }),
)

/**
 * Workflow URI selector.
 * Extracts URI from workflow data (e.g., "agenta:builtin:auto_exact_match:v0").
 */
const uriAtomFamily = atomFamily((workflowId: string) =>
    atom<string | null>((get) => {
        const entity = get(workflowBaseEntityAtomFamily(workflowId))
        return entity?.data?.uri ?? null
    }),
)

/**
 * Workflow key selector.
 * Parses the key segment from the URI (e.g., "auto_exact_match").
 */
const workflowKeyAtomFamily = atomFamily((workflowId: string) =>
    atom<string | null>((get) => {
        const uri = get(uriAtomFamily(workflowId))
        return parseWorkflowKeyFromUri(uri)
    }),
)

/**
 * Workflow parameters selector.
 * Returns the configuration parameters.
 */
const parametersAtomFamily = atomFamily((workflowId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(workflowBaseEntityAtomFamily(workflowId))
        return resolveParameters(entity?.data) ?? null
    }),
)

/**
 * Workflow schemas selector.
 * Returns the JSON schemas for parameters, inputs, and outputs.
 */
const schemasAtomFamily = atomFamily((workflowId: string) =>
    atom((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        return entity?.data?.schemas ?? null
    }),
)

/**
 * Input schema selector (from data.schemas.inputs).
 */
const inputSchemaAtomFamily = atomFamily((workflowId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        return resolveInputSchema(get(workflowEntityAtomFamily(workflowId))?.data) ?? null
    }),
)

/**
 * Output schema selector (from data.schemas.outputs).
 */
const outputSchemaAtomFamily = atomFamily((workflowId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        return resolveOutputSchema(get(workflowEntityAtomFamily(workflowId))?.data) ?? null
    }),
)

// ============================================================================
// FLAG SELECTORS — Raw flags
// ============================================================================

/**
 * All workflow flags (raw object from backend).
 */
const flagsAtomFamily = atomFamily((workflowId: string) =>
    atom((get) => {
        const entity = get(workflowBaseEntityAtomFamily(workflowId))
        return entity?.flags ?? null
    }),
)

// -- URI-derived flags --

/** Is managed (provider is "agenta"). */
const isManagedAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => get(flagsAtomFamily(workflowId))?.is_managed ?? false),
)

/** Is custom (kind is "custom" — user-deployed code on agenta platform). */
const isCustomAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => get(flagsAtomFamily(workflowId))?.is_custom ?? false),
)

/** Is LLM handler (key is "llm"). */
const isLlmAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => get(flagsAtomFamily(workflowId))?.is_llm ?? false),
)

/** Is hook/webhook handler (key is "hook"). */
const isHookAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => get(flagsAtomFamily(workflowId))?.is_hook ?? false),
)

/** Is code/script handler (key is "code"). */
const isCodeAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => get(flagsAtomFamily(workflowId))?.is_code ?? false),
)

/** Is matcher evaluator (key is "match"). */
const isMatchAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => get(flagsAtomFamily(workflowId))?.is_match ?? false),
)

/** Is human annotation workflow (key is "trace"). */
const isHumanAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => get(flagsAtomFamily(workflowId))?.is_feedback ?? false),
)

// -- Interface-derived flags --

/** Has chat/message semantics (from schema). */
const isChatAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => get(flagsAtomFamily(workflowId))?.is_chat ?? false),
)

/** Has a webhook/service URL. */
const hasUrlAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => get(flagsAtomFamily(workflowId))?.has_url ?? false),
)

/** Has embedded script content. */
const hasScriptAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => get(flagsAtomFamily(workflowId))?.has_script ?? false),
)

/** Has an in-process handler (SDK only). */
const hasHandlerAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => get(flagsAtomFamily(workflowId))?.has_handler ?? false),
)

// -- User-defined role flags --

/** Can be used as an application. */
const isApplicationAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => get(flagsAtomFamily(workflowId))?.is_application ?? false),
)

/** Can be used as an evaluator. */
const isEvaluatorAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => get(flagsAtomFamily(workflowId))?.is_evaluator ?? false),
)

/** Is a reusable snippet. */
const isSnippetAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => get(flagsAtomFamily(workflowId))?.is_snippet ?? false),
)

// -- Local-only flags --

/** Is ephemeral (created from trace data, local-only). */
const isBaseAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => get(flagsAtomFamily(workflowId))?.is_base ?? false),
)

// ============================================================================
// DERIVED CAPABILITY SELECTORS
// ============================================================================

/**
 * Workflow type discriminant for UI rendering.
 *
 * Derives a single category string from flags, checked in priority order.
 * Use this to switch UI rendering modes instead of checking multiple flags.
 */
export type WorkflowType =
    | "human"
    | "llm"
    | "code"
    | "hook"
    | "match"
    | "custom"
    | "chat"
    | "completion"

const workflowTypeAtomFamily = atomFamily((workflowId: string) =>
    atom<WorkflowType>((get) => {
        const flags = get(flagsAtomFamily(workflowId))
        if (flags?.is_feedback) return "human"
        if (flags?.is_llm) return "llm"
        if (flags?.is_code) return "code"
        if (flags?.is_hook) return "hook"
        if (flags?.is_match) return "match"
        if (flags?.is_custom) return "custom"
        if (flags?.is_chat) return "chat"
        return "completion"
    }),
)

/**
 * Can this workflow be invoked/executed?
 *
 * True when the workflow has a URI (resolvable handler), URL (webhook),
 * handler (SDK in-process), or script (code execution).
 */
const canRunAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => {
        const flags = get(flagsAtomFamily(workflowId))
        const entity = get(workflowBaseEntityAtomFamily(workflowId))
        return !!(flags?.has_url || flags?.has_handler || flags?.has_script) || !!entity?.data?.uri
    }),
)

/**
 * Can this workflow be deployed to an endpoint?
 *
 * True for application-role workflows that have some execution target
 * and are not snippets.
 */
const canDeployAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => {
        const flags = get(flagsAtomFamily(workflowId))
        if (!flags?.is_application) return false
        if (flags.is_snippet) return false
        return !!(
            flags.has_url ||
            flags.has_handler ||
            get(workflowBaseEntityAtomFamily(workflowId))?.data?.uri
        )
    }),
)

/**
 * Does the workflow require an external URL to run?
 *
 * True for hooks and custom workflows that don't have an in-process handler.
 */
const needsUrlAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => {
        const flags = get(flagsAtomFamily(workflowId))
        if (flags?.has_handler) return false
        return !!(flags?.is_hook || flags?.is_custom)
    }),
)

// ============================================================================
// IDENTITY SELECTORS
// ============================================================================

/**
 * Workflow name selector.
 */
const nameAtomFamily = atomFamily((workflowId: string) =>
    atom<string | null>((get) => {
        const entity = get(workflowBaseEntityAtomFamily(workflowId))
        return entity?.name ?? null
    }),
)

/**
 * Workflow slug selector.
 */
const slugAtomFamily = atomFamily((workflowId: string) =>
    atom<string | null>((get) => {
        const entity = get(workflowBaseEntityAtomFamily(workflowId))
        return entity?.slug ?? null
    }),
)

// ============================================================================
// RUNNABLE SELECTORS (absorbed from bridge + runnableSetup)
// ============================================================================

/**
 * Configuration selector.
 *
 * Returns entity parameters directly. Evaluator nesting is already applied
 * in `workflowEntityAtomFamily` (entity merge layer), so no transform needed.
 */
const configurationSelectorAtomFamily = atomFamily((workflowId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(workflowBaseEntityAtomFamily(workflowId))
        return resolveParameters(entity?.data) ?? null
    }),
)

/**
 * Parameters schema selector.
 *
 * For evaluator workflows with incomplete stored schemas (e.g., only
 * `correct_answer_key`), enriches the schema from the catalog template.
 * The catalog template provides the full `settings_template` metadata
 * (prompt_template, model, response_type, json_schema, etc.) which is
 * converted to JSON Schema and merged with the stored schema.
 *
 * Evaluator nesting is already applied in `workflowEntityAtomFamily`.
 */
const parametersSchemaAtomFamily = atomFamily((workflowId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        const storedSchema = resolveParametersSchema(entity?.data) ?? null

        const enrichSchemaRefs = (schema: unknown): unknown => {
            if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema

            const node = schema as Record<string, unknown>
            const agTypeRef = node["x-ag-type-ref"] as string | undefined
            let merged: Record<string, unknown> = node

            if (agTypeRef) {
                const agTypeQuery = get(agTypeSchemaAtomFamily(agTypeRef))
                const agTypeSchema = agTypeQuery.data
                if (agTypeSchema && typeof agTypeSchema === "object") {
                    merged = {
                        ...agTypeSchema,
                        ...node,
                        "x-ag-type-ref": agTypeRef,
                        ...(node.title ? {title: node.title} : {}),
                        ...(node.description ? {description: node.description} : {}),
                        ...(node.default !== undefined ? {default: node.default} : {}),
                    }
                }
            }

            const properties = merged.properties as Record<string, unknown> | undefined
            const items = merged.items

            return {
                ...merged,
                ...(properties
                    ? {
                          properties: Object.fromEntries(
                              Object.entries(properties).map(([key, value]) => [
                                  key,
                                  enrichSchemaRefs(value),
                              ]),
                          ),
                      }
                    : {}),
                ...(items ? {items: enrichSchemaRefs(items)} : {}),
            }
        }

        // For non-evaluators, enrich any opaque x-ag-type-ref properties with
        // full sub-property schemas fetched from the ag-types endpoint
        if (!entity?.flags?.is_evaluator) {
            if (!storedSchema?.properties) return storedSchema

            const properties = storedSchema.properties as Record<string, Record<string, unknown>>
            let enriched = false
            const enrichedProperties: Record<string, unknown> = {}

            for (const [key, prop] of Object.entries(properties)) {
                const enrichedProp = enrichSchemaRefs(prop)
                if (enrichedProp !== prop) {
                    enrichedProperties[key] = enrichedProp
                    enriched = true
                    continue
                }
                enrichedProperties[key] = prop
            }

            if (!enriched) return storedSchema
            return {...storedSchema, properties: enrichedProperties}
        }

        // If stored schema is valid JSON Schema (has type + properties), return as-is.
        // Settings_template format has properties but no type — needs enrichment.
        if (storedSchema?.properties && storedSchema?.type) {
            return enrichSchemaRefs(storedSchema) as Record<string, unknown>
        }

        // Evaluator with no/incomplete schema — try to enrich from catalog template
        const uri = entity?.data?.uri as string | undefined
        const evaluatorKey = parseWorkflowKeyFromUri(uri)

        if (!evaluatorKey) return storedSchema

        const templates = get(evaluatorTemplatesDataAtom)

        const template = templates.find((t) => t.key === evaluatorKey)
        if (!template) return storedSchema

        // Catalog template schemas.parameters may be settings_template format
        const templateParams = template.data?.schemas?.parameters as
            | Record<string, unknown>
            | undefined

        if (!templateParams) return storedSchema

        // If the template schema has properties, merge with stored schema
        if (templateParams.properties) {
            // Template already in JSON Schema format — merge (stored takes precedence)
            const mergedTemplateSchema = {
                ...templateParams,
                properties: {
                    ...(templateParams.properties as Record<string, unknown>),
                    ...((storedSchema?.properties as Record<string, unknown>) ?? {}),
                },
            }
            return enrichSchemaRefs(mergedTemplateSchema) as Record<string, unknown>
        }

        // Template is in settings_template metadata format — convert to JSON Schema
        // and merge. The template keys are field definitions like:
        // { prompt_template: { type: "messages", label: "..." }, model: { type: "multiple_choice" } }
        const schemaProperties: Record<string, Record<string, unknown>> = {}
        const hiddenKeys = new Set<string>()
        for (const [key, value] of Object.entries(templateParams)) {
            if (!value || typeof value !== "object" || Array.isArray(value)) continue
            const meta = value as Record<string, unknown>
            const templateType = meta.type as string | undefined
            if (templateType === "hidden") {
                hiddenKeys.add(key)
                continue
            }

            const prop: Record<string, unknown> = {
                title: (meta.label as string) ?? key,
            }
            if (meta.description) prop.description = meta.description

            switch (templateType) {
                case "messages":
                    prop.type = "array"
                    prop["x-parameter"] = "messages"
                    break
                case "code":
                    prop.type = "string"
                    prop["x-parameters"] = {code: true}
                    break
                case "boolean":
                    prop.type = "boolean"
                    break
                case "multiple_choice":
                    prop.type = "string"
                    if (Array.isArray(meta.options)) prop.enum = meta.options
                    break
                case "number":
                case "integer":
                case "float":
                    prop.type = "number"
                    if (meta.min !== undefined) prop.minimum = meta.min
                    if (meta.max !== undefined) prop.maximum = meta.max
                    break
                case "object":
                    prop.type = "object"
                    break
                case "fields_tags_editor":
                    prop.type = "array"
                    prop.items = {type: "string"}
                    prop["x-parameter"] = "fields_tags_editor"
                    break
                case "llm_response_schema":
                    prop.type = "object"
                    prop["x-parameter"] = "feedback_config"
                    break
                default:
                    prop.type = "string"
                    break
            }

            if (meta["x-ag-ui-advanced"] === true || meta.advanced === true)
                prop["x-advanced"] = true

            schemaProperties[key] = prop
        }

        // Filter stored schema properties to exclude hidden fields from the template.
        // The inspect endpoint may return hidden fields (e.g. version, requires_llm_api_keys)
        // as visible properties — we must not let them override the template's filtering.
        const storedProps = (storedSchema?.properties as Record<string, unknown>) ?? {}
        const filteredStoredProps: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(storedProps)) {
            if (!hiddenKeys.has(key)) {
                filteredStoredProps[key] = value
            }
        }

        const mergedSchema = {
            type: "object",
            properties: {
                ...schemaProperties,
                ...filteredStoredProps,
            },
        }

        return enrichSchemaRefs(mergedSchema) as Record<string, unknown>
    }),
)

/**
 * Input ports selector.
 * Derives ports from schema, prompt template variables, or ephemeral trace metadata.
 */
const inputPortsAtomFamily = atomFamily((workflowId: string) =>
    atom<RunnablePort[]>((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        if (!entity) return []

        // Ephemeral workflow: derive from template variables, then trace inputs
        if (entity.flags?.is_base) {
            const params = resolveParameters(entity.data)
            if (params) {
                const vars = extractVariablesFromConfig(params as Record<string, unknown>)
                if (vars.length > 0) {
                    return vars.map((key) => ({key, name: key, type: "string", required: true}))
                }
            }
            // Fallback: derive from trace inputs stored in meta
            const meta = entity.meta as Record<string, unknown> | null | undefined
            const inputs = meta?.inputs as Record<string, unknown> | undefined
            if (inputs) {
                const isChat = entity.flags?.is_chat ?? false
                const inputKeys = Object.keys(inputs).filter(
                    (key) => !(isChat && key === "messages"),
                )
                return inputKeys.map((key) => ({key, name: key, type: "string", required: false}))
            }
            return []
        }

        const inputsSchema = resolveInputSchema(entity.data)
        const schemaPorts = extractInputPortsFromSchema(inputsSchema)
        if (schemaPorts.length > 0) return schemaPorts

        // Fallback: derive input variables from prompt templates in parameters.
        // Filter out names that match system-level fields (x-ag-*) in the
        // inputs schema — these are runtime-managed (e.g. context, consent)
        // and should not appear as user-facing inputs.
        const params = resolveParameters(entity.data)
        if (params) {
            const systemFields = extractSystemFieldNames(inputsSchema)
            const vars = extractVariablesFromConfig(params as Record<string, unknown>).filter(
                (key) => !systemFields.has(key),
            )
            if (vars.length > 0) {
                return vars.map((key) => ({key, name: key, type: "string", required: true}))
            }
        }
        return []
    }),
)

/**
 * Output ports selector.
 * Derives ports from schema with evaluator-specific defaults.
 * For ephemeral workflows, derives from trace outputs in meta.
 */
const outputPortsAtomFamily = atomFamily((workflowId: string) =>
    atom<RunnablePort[]>((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))

        // Ephemeral workflow: derive from trace outputs stored in meta
        if (entity?.flags?.is_base) {
            const meta = entity.meta as Record<string, unknown> | null | undefined
            const outputs = meta?.outputs
            if (outputs && typeof outputs === "object") {
                return Object.keys(outputs as Record<string, unknown>).map((key) => ({
                    key,
                    name: key,
                    type: "string",
                }))
            }
            return [{key: "output", name: "Output", type: "string"}]
        }

        const schemaOutputs = extractOutputPortsFromSchema(entity?.data?.schemas?.outputs)

        // For evaluators, the backend output schema may be incomplete (e.g., only "score"
        // when the json_schema config also defines "reasoning"). Prefer the richer source.
        if (entity?.flags?.is_evaluator) {
            const config = resolveParameters(entity.data) as Record<string, unknown> | undefined
            // Nested form: feedback_config.json_schema.schema.properties
            const feedbackConfig = config?.feedback_config as Record<string, unknown> | undefined
            const jsonSchema = feedbackConfig?.json_schema as
                | {schema?: {properties?: Record<string, unknown>}}
                | undefined
            // Also check flat form (raw backend data): json_schema at top level
            const flatJsonSchema = config?.json_schema as typeof jsonSchema | undefined
            const fbProperties =
                jsonSchema?.schema?.properties ?? flatJsonSchema?.schema?.properties
            if (fbProperties && Object.keys(fbProperties).length > schemaOutputs.length) {
                return Object.entries(fbProperties).map(([key, prop]) => ({
                    key,
                    name: formatKeyAsName(key),
                    type: ((prop as Record<string, unknown>)?.type as string) ?? "string",
                    schema: prop,
                }))
            }
            if (schemaOutputs.length > 0) return schemaOutputs
            return [{key: "score", name: "Score", type: "number"}]
        }

        if (schemaOutputs.length > 0) return schemaOutputs
        return [{key: "output", name: "Output", type: "string"}]
    }),
)

/**
 * IO schemas selector. Returns `{inputSchema, outputSchema}` tuple.
 */
const ioSchemasAtomFamily = atomFamily((workflowId: string) =>
    atom<{inputSchema?: unknown; outputSchema?: unknown}>((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        if (!entity?.data?.schemas) return {}
        return {
            inputSchema: entity.data.schemas.inputs ?? undefined,
            outputSchema: entity.data.schemas.outputs ?? undefined,
        }
    }),
)

/**
 * Evaluator definition selector.
 *
 * Builds a full `EvaluatorDefinition` (id, name, slug, metrics) from the
 * workflow entity data. Metrics are extracted from `data.schemas.outputs`.
 *
 * Use this when you need the evaluator definition with metrics resolved from
 * the entity's output schema (e.g., for annotation panels, metric columns).
 */
const evaluatorDefinitionAtomFamily = atomFamily((workflowId: string) =>
    atom<EvaluatorDefinition | null>((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        if (!entity) return null
        return toEvaluatorDefinitionFromWorkflow(entity)
    }),
)

/**
 * Server data selector (pre-draft entity data for commit diff baselines).
 */
const serverDataAtomFamily = atomFamily((workflowId: string) =>
    atom<Workflow | null>((get) => {
        return get(workflowServerDataSelectorFamily(workflowId)) as Workflow | null
    }),
)

/**
 * Server configuration selector (params from server, before draft overlay).
 * For evaluator workflows, applies the same nesting transform as `configurationSelectorAtomFamily`
 * so that commit diffs compare like-for-like (both sides nested).
 */
const serverConfigurationAtomFamily = atomFamily((workflowId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const serverData = get(workflowServerDataSelectorFamily(workflowId))
        const flatParams = (serverData?.data?.parameters as Record<string, unknown> | null) ?? null
        if (!flatParams) return null

        const isEvaluator = !!serverData?.flags?.is_evaluator
        if (isEvaluator) {
            const flatSchema =
                (serverData?.data?.schemas?.parameters as Record<string, unknown> | null) ?? null
            return nestEvaluatorConfiguration(flatParams, flatSchema)
        }
        return flatParams
    }),
)

/**
 * Update configuration action.
 * Wraps parameters as `{data: {parameters}}` and applies evaluator flattening.
 *
 * Use this instead of `actions.update` when writing configuration changes from the UI,
 * as it handles the evaluator flat/nested conversion automatically.
 */
const updateConfigurationAtom = atom(
    null,
    (get, set, workflowId: string, params: Record<string, unknown>) => {
        // For evaluator workflows, flatten nested config back to flat format.
        // Use flat source data (local-first, server fallback) as the baseline
        // for hidden-field restoration — never use the display-transformed entity.
        // NOTE: Use flatSource (local-first) for evaluator detection, not
        // workflowServerDataSelectorFamily which returns null for ephemeral
        // evaluators created from templates — causing flatten to be skipped
        // and advanced_settings to vanish on re-nesting.
        const flatSource = getFlatSourceData(get, workflowId)
        const isEvaluator = flatSource?.flags?.is_evaluator ?? false
        const flatParams = (flatSource?.data?.parameters as Record<string, unknown> | null) ?? null
        const finalParams = isEvaluator ? flattenEvaluatorConfiguration(params, flatParams) : params

        set(updateWorkflowDraftAtom, workflowId, {
            data: {parameters: finalParams},
        } as Partial<Workflow>)
    },
)

// ============================================================================
// MOLECULE DEFINITION
// ============================================================================

/**
 * Workflow molecule — unified API for workflow entity state.
 *
 * Follows the same pattern as `evaluatorMolecule` and `appRevisionMolecule`.
 */
export const workflowMolecule = {
    // ========================================================================
    // SELECTORS (reactive atom families — use with useAtomValue)
    // ========================================================================
    selectors: {
        /** Merged entity data (server + draft, no schema resolution) */
        data: dataAtomFamily,
        /** Resolved entity data (server + draft + schema resolution via inspect/OpenAPI) */
        resolvedData: resolvedDataAtomFamily,
        /** Query state (loading, error) */
        query: queryAtomFamily,
        /** Is dirty (has local edits) */
        isDirty: workflowIsDirtyAtomFamily,
        /** Is ephemeral (created from template, not yet committed) */
        isEphemeral: workflowIsEphemeralAtomFamily,
        /** Workflow URI (e.g., "agenta:builtin:auto_exact_match:v0") */
        uri: uriAtomFamily,
        /** Workflow key parsed from URI (e.g., "auto_exact_match") */
        workflowKey: workflowKeyAtomFamily,
        /** Raw parameters from entity data */
        parameters: parametersAtomFamily,
        /** JSON schemas (parameters, inputs, outputs) */
        schemas: schemasAtomFamily,
        /** Input schema */
        inputSchema: inputSchemaAtomFamily,
        /** Output schema */
        outputSchema: outputSchemaAtomFamily,
        /** Workflow name */
        name: nameAtomFamily,
        /** Workflow slug */
        slug: slugAtomFamily,

        // -- Raw flags --

        /** All workflow flags (raw object) */
        flags: flagsAtomFamily,
        // URI-derived
        /** Is managed (provider is "agenta") */
        isManaged: isManagedAtomFamily,
        /** Is custom (kind is "custom") */
        isCustom: isCustomAtomFamily,
        /** Is LLM handler */
        isLlm: isLlmAtomFamily,
        /** Is hook/webhook handler */
        isHook: isHookAtomFamily,
        /** Is code/script handler */
        isCode: isCodeAtomFamily,
        /** Is matcher evaluator */
        isMatch: isMatchAtomFamily,
        /** Is human annotation workflow */
        isHuman: isHumanAtomFamily,
        // Interface-derived
        /** Has chat/message semantics */
        isChat: isChatAtomFamily,
        /** Has a webhook/service URL */
        hasUrl: hasUrlAtomFamily,
        /** Has embedded script content */
        hasScript: hasScriptAtomFamily,
        /** Has an in-process handler (SDK only) */
        hasHandler: hasHandlerAtomFamily,
        // User-defined role
        /** Can be used as an application */
        isApplication: isApplicationAtomFamily,
        /** Can be used as an evaluator */
        isEvaluator: isEvaluatorAtomFamily,
        /** Is a reusable snippet */
        isSnippet: isSnippetAtomFamily,
        // Local-only
        /** Is ephemeral trace-based workflow (local-only) */
        isBase: isBaseAtomFamily,

        // -- Derived capabilities --

        /** Discriminated workflow type for UI rendering */
        workflowType: workflowTypeAtomFamily,
        /** Can the workflow be invoked/executed? */
        canRun: canRunAtomFamily,
        /** Can the workflow be deployed to an endpoint? */
        canDeploy: canDeployAtomFamily,
        /** Does the workflow require an external URL to run? */
        needsUrl: needsUrlAtomFamily,

        // -- Runnable selectors --

        /** Configuration with evaluator nesting applied */
        configuration: configurationSelectorAtomFamily,
        /** Parameters schema with evaluator nesting applied */
        parametersSchema: parametersSchemaAtomFamily,
        /** Input ports derived from schema/params/meta */
        inputPorts: inputPortsAtomFamily,
        /** Output ports derived from schema/flags/meta */
        outputPorts: outputPortsAtomFamily,
        /** IO schemas as {inputSchema, outputSchema} tuple */
        ioSchemas: ioSchemasAtomFamily,
        /** Evaluator definition (id, name, slug, metrics from output schema) */
        evaluatorDefinition: evaluatorDefinitionAtomFamily,
        /** Server data before draft overlay (for commit diffs) */
        serverData: serverDataAtomFamily,
        /** Server configuration (flat params from server) */
        serverConfiguration: serverConfigurationAtomFamily,
        /** Execution mode: "chat" | "completion" from flags */
        executionMode: runnableExecutionModeAtomFamily,
        /** Resolved invocation URL (for playground execution via {serviceUrl}/invoke) */
        invocationUrl: runnableInvocationUrlAtomFamily,
        /** Deployment URL (for code snippets — user-facing /run endpoint) */
        deploymentUrl: runnableDeploymentUrlAtomFamily,
        /** Pre-built request payload for execution */
        requestPayload: runnableRequestPayloadAtomFamily,
    },

    // ========================================================================
    // ATOMS (raw store atoms — for advanced composition)
    // ========================================================================
    atoms: {
        /** Project ID atom */
        projectId: workflowProjectIdAtom,
        /** App workflows list query atom */
        listQuery: appWorkflowsListQueryAtom,
        /** List data atom */
        listData: workflowsListDataAtom,
        /** Non-archived workflows */
        nonArchived: nonArchivedWorkflowsAtom,
        /** Per-entity query */
        query: workflowQueryAtomFamily,
        /** Per-entity inspect query (evaluator workflows — resolves full schema via URI) */
        inspect: workflowInspectAtomFamily,
        /** Per-entity app schema query (app workflows — resolves schema via OpenAPI) */
        appSchema: workflowAppSchemaAtomFamily,
        /** Per-entity interface schemas query (builtin workflows — resolves schema via URI) */
        interfaceSchemas: workflowInterfaceSchemasAtomFamily,
        /** Per-entity draft */
        draft: workflowDraftAtomFamily,
        /** Per-entity base data (no inspect/OpenAPI subscriptions) */
        baseEntity: workflowBaseEntityAtomFamily,
        /** Per-entity merged data (with schema resolution) */
        entity: workflowEntityAtomFamily,
        /** Per-entity dirty flag */
        isDirty: workflowIsDirtyAtomFamily,
        /** Per-entity ephemeral flag */
        isEphemeral: workflowIsEphemeralAtomFamily,
    },

    // ========================================================================
    // ACTIONS (write atoms — use with useSetAtom or set())
    // ========================================================================
    actions: {
        /** Update workflow draft */
        update: updateWorkflowDraftAtom,
        /** Discard workflow draft */
        discard: discardWorkflowDraftAtom,
        /** Update configuration with evaluator flat/nested conversion */
        updateConfiguration: updateConfigurationAtom,
    },

    // ========================================================================
    // GET (imperative read API — for callbacks outside React)
    // ========================================================================
    get: {
        data: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(workflowBaseEntityAtomFamily(workflowId)),
        resolvedData: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(workflowEntityAtomFamily(workflowId)),
        isDirty: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(workflowIsDirtyAtomFamily(workflowId)),
        isEphemeral: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(workflowIsEphemeralAtomFamily(workflowId)),
        uri: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(uriAtomFamily(workflowId)),
        workflowKey: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(workflowKeyAtomFamily(workflowId)),
        parameters: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(parametersAtomFamily(workflowId)),
        name: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(nameAtomFamily(workflowId)),
        // Raw flags
        flags: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(flagsAtomFamily(workflowId)),
        isManaged: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(isManagedAtomFamily(workflowId)),
        isCustom: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(isCustomAtomFamily(workflowId)),
        isLlm: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(isLlmAtomFamily(workflowId)),
        isHook: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(isHookAtomFamily(workflowId)),
        isCode: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(isCodeAtomFamily(workflowId)),
        isMatch: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(isMatchAtomFamily(workflowId)),
        isHuman: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(isHumanAtomFamily(workflowId)),
        isChat: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(isChatAtomFamily(workflowId)),
        hasUrl: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(hasUrlAtomFamily(workflowId)),
        hasScript: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(hasScriptAtomFamily(workflowId)),
        hasHandler: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(hasHandlerAtomFamily(workflowId)),
        isApplication: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(isApplicationAtomFamily(workflowId)),
        isEvaluator: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(isEvaluatorAtomFamily(workflowId)),
        isSnippet: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(isSnippetAtomFamily(workflowId)),
        isBase: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(isBaseAtomFamily(workflowId)),
        // Derived capabilities
        workflowType: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(workflowTypeAtomFamily(workflowId)),
        canRun: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(canRunAtomFamily(workflowId)),
        canDeploy: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(canDeployAtomFamily(workflowId)),
        needsUrl: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(needsUrlAtomFamily(workflowId)),
        // Runnable
        configuration: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(configurationSelectorAtomFamily(workflowId)),
        inputPorts: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(inputPortsAtomFamily(workflowId)),
        outputPorts: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(outputPortsAtomFamily(workflowId)),
        executionMode: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(runnableExecutionModeAtomFamily(workflowId)),
        invocationUrl: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(runnableInvocationUrlAtomFamily(workflowId)),
        deploymentUrl: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(runnableDeploymentUrlAtomFamily(workflowId)),
        serverData: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(serverDataAtomFamily(workflowId)),
    },

    // ========================================================================
    // SET (imperative write API — for callbacks outside React)
    // ========================================================================
    set: {
        projectId: (projectId: string | null, options?: StoreOptions) =>
            getStore(options).set(workflowProjectIdAtom, projectId),
        update: (workflowId: string, updates: Partial<Workflow>, options?: StoreOptions) =>
            getStore(options).set(updateWorkflowDraftAtom, workflowId, updates),
        discard: (workflowId: string, options?: StoreOptions) =>
            getStore(options).set(discardWorkflowDraftAtom, workflowId),
        updateConfiguration: (
            workflowId: string,
            params: Record<string, unknown>,
            options?: StoreOptions,
        ) => getStore(options).set(updateConfigurationAtom, workflowId, params),
        /**
         * Seed a workflow entity into the local server data store without
         * persisting it to the API. Use this to pre-load a server-fetched
         * Workflow so that `workflowMolecule.selectors.*` can resolve it
         * in the default store without a React context or query subscription.
         */
        seedEntity: (workflowId: string, workflow: Workflow, options?: StoreOptions) =>
            getStore(options).set(workflowLocalServerDataAtomFamily(workflowId), workflow),
    },

    // ========================================================================
    // CACHE (invalidation utilities)
    // ========================================================================
    cache: {
        invalidateList: invalidateWorkflowsListCache,
        invalidateDetail: invalidateWorkflowCache,
    },

    // ========================================================================
    // STATIC UTILITIES
    // ========================================================================

    /** Normalize workflow execution response (v3 vs legacy format) */
    normalizeResponse: normalizeWorkflowResponse,
}

export type WorkflowMolecule = typeof workflowMolecule
