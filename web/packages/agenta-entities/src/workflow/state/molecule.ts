/**
 * Workflow Molecule
 *
 * Unified API for workflow entity state management.
 * Follows the molecule pattern for consistency with other entities
 * (appRevision, evaluator, testset, etc.).
 *
 * Unlike the evaluator molecule, this includes flag-specific selectors
 * for all four workflow flags (is_custom, is_evaluator, is_human, is_chat).
 *
 * @example
 * ```typescript
 * import { workflowMolecule } from '@agenta/entities/workflow'
 *
 * // Selectors (reactive)
 * const data = useAtomValue(workflowMolecule.selectors.data(workflowId))
 * const isDirty = useAtomValue(workflowMolecule.selectors.isDirty(workflowId))
 * const isChat = useAtomValue(workflowMolecule.selectors.isChat(workflowId))
 *
 * // Actions (write atoms)
 * const update = useSetAtom(workflowMolecule.actions.update)
 * update(workflowId, { data: { parameters: newParams } })
 *
 * // Imperative API (outside React)
 * const data = workflowMolecule.get.data(workflowId)
 * workflowMolecule.set.update(workflowId, { data: { parameters: newParams } })
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
    nestEvaluatorSchema,
} from "../../runnable/evaluatorTransforms"
import {extractInputPortsFromSchema, extractOutputPortsFromSchema} from "../../runnable/portHelpers"
import {normalizeWorkflowResponse} from "../../runnable/responseHelpers"
import {extractVariablesFromConfig} from "../../runnable/utils"
import type {RunnablePort, StoreOptions} from "../../shared"
import {isLocalDraftId, isPlaceholderId} from "../../shared"
import type {Workflow} from "../core"
import {parseWorkflowKeyFromUri} from "../core/schema"

import {workflowsListDataAtom, nonArchivedWorkflowsAtom} from "./allWorkflows"
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
    workflowEntityAtomFamily,
    workflowLocalServerDataAtomFamily,
    workflowIsDirtyAtomFamily,
    workflowIsEphemeralAtomFamily,
    workflowServerDataSelectorFamily,
    updateWorkflowDraftAtom,
    discardWorkflowDraftAtom,
    invalidateWorkflowsListCache,
    invalidateWorkflowCache,
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
        const entity = get(workflowEntityAtomFamily(workflowId))
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
        const entity = get(workflowEntityAtomFamily(workflowId))
        return entity?.data?.parameters ?? null
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
        const schemas = get(schemasAtomFamily(workflowId))
        return (schemas?.inputs as Record<string, unknown> | null) ?? null
    }),
)

/**
 * Output schema selector (from data.schemas.outputs).
 */
const outputSchemaAtomFamily = atomFamily((workflowId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const schemas = get(schemasAtomFamily(workflowId))
        return (schemas?.outputs as Record<string, unknown> | null) ?? null
    }),
)

// ============================================================================
// FLAG SELECTORS
// ============================================================================

/**
 * Workflow flags selector (all four flags).
 */
const flagsAtomFamily = atomFamily((workflowId: string) =>
    atom((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        return entity?.flags ?? null
    }),
)

/**
 * Is chat workflow (flags.is_chat).
 */
const isChatAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => {
        const flags = get(flagsAtomFamily(workflowId))
        return flags?.is_chat ?? false
    }),
)

/**
 * Is evaluator workflow (flags.is_evaluator).
 */
const isEvaluatorAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => {
        const flags = get(flagsAtomFamily(workflowId))
        return flags?.is_evaluator ?? false
    }),
)

/**
 * Is custom workflow (user-defined, not built-in).
 */
const isCustomAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => {
        const flags = get(flagsAtomFamily(workflowId))
        return flags?.is_custom ?? false
    }),
)

/**
 * Is human workflow.
 */
const isHumanAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => {
        const flags = get(flagsAtomFamily(workflowId))
        return flags?.is_human ?? false
    }),
)

/**
 * Is base/ephemeral workflow (created from trace data, local-only).
 */
const isBaseAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => {
        const flags = get(flagsAtomFamily(workflowId))
        return flags?.is_base ?? false
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
        const entity = get(workflowEntityAtomFamily(workflowId))
        return entity?.name ?? null
    }),
)

/**
 * Workflow slug selector.
 */
const slugAtomFamily = atomFamily((workflowId: string) =>
    atom<string | null>((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        return entity?.slug ?? null
    }),
)

// ============================================================================
// RUNNABLE SELECTORS (absorbed from bridge + runnableSetup)
// ============================================================================

/**
 * Configuration selector with evaluator nesting applied.
 *
 * For evaluator workflows, transforms flat backend params to nested prompt structure.
 * For app workflows, returns data.parameters as-is.
 */
const configurationSelectorAtomFamily = atomFamily((workflowId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        const flatParams = entity?.data?.parameters ?? entity?.data?.configuration ?? null
        if (!flatParams) return null

        const isEvaluator = !!entity?.flags?.is_evaluator
        if (isEvaluator) {
            const flatSchema =
                (entity?.data?.schemas?.parameters as Record<string, unknown> | null) ?? null
            const nested = nestEvaluatorConfiguration(
                flatParams as Record<string, unknown>,
                flatSchema,
            )
            return nested
        }
        return flatParams as Record<string, unknown>
    }),
)

/**
 * Parameters schema selector with evaluator nesting applied.
 *
 * For evaluator workflows, transforms flat schema to nested prompt structure.
 * For app workflows, returns data.schemas.parameters as-is.
 */
const parametersSchemaAtomFamily = atomFamily((workflowId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        const flatSchema =
            (entity?.data?.schemas?.parameters as Record<string, unknown> | null) ?? null
        if (!flatSchema) return null

        const isEvaluator = !!entity?.flags?.is_evaluator
        if (isEvaluator) {
            return nestEvaluatorSchema(flatSchema) as Record<string, unknown>
        }
        return flatSchema
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
            const params = entity.data?.parameters ?? entity.data?.configuration
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
        if (schemaOutputs.length > 0) return schemaOutputs

        // Evaluator-type workflows default to score/number
        if (entity?.flags?.is_evaluator) {
            return [{key: "score", name: "Score", type: "number"}]
        }
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
        // For evaluator workflows, flatten nested config back to flat format
        // IMPORTANT: Use pure server data, NOT merged entity data
        const serverData = get(workflowServerDataSelectorFamily(workflowId))
        const isEvaluator = serverData?.flags?.is_evaluator ?? false
        const finalParams = isEvaluator
            ? flattenEvaluatorConfiguration(
                  params,
                  (serverData?.data?.parameters as Record<string, unknown> | null) ?? null,
              )
            : params

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
        /** Merged entity data (server + draft) */
        data: dataAtomFamily,
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
        /** Workflow flags */
        flags: flagsAtomFamily,
        /** Is chat workflow */
        isChat: isChatAtomFamily,
        /** Is evaluator workflow */
        isEvaluator: isEvaluatorAtomFamily,
        /** Is custom workflow */
        isCustom: isCustomAtomFamily,
        /** Is human workflow */
        isHuman: isHumanAtomFamily,
        /** Is base/ephemeral workflow (from trace data) */
        isBase: isBaseAtomFamily,
        /** Workflow name */
        name: nameAtomFamily,
        /** Workflow slug */
        slug: slugAtomFamily,

        // -- Runnable selectors (absorbed from bridge) --

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
        /** Server data before draft overlay (for commit diffs) */
        serverData: serverDataAtomFamily,
        /** Server configuration (flat params from server) */
        serverConfiguration: serverConfigurationAtomFamily,
        /** Execution mode: "chat" | "completion" from flags */
        executionMode: runnableExecutionModeAtomFamily,
        /** Resolved invocation URL (for playground execution via /preview/workflows/invoke) */
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
        /** Per-entity merged data */
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
        flags: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(flagsAtomFamily(workflowId)),
        name: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(nameAtomFamily(workflowId)),
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
