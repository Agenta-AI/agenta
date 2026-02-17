/**
 * BaseRunnable Entity
 *
 * A generic, local-only runnable entity created from raw JSON data.
 * Not tied to any specific backend entity type (app, evaluator, etc.).
 *
 * Use cases:
 * - Loading trace span data into the playground
 * - Creating ephemeral runnables from arbitrary configuration
 *
 * Key properties:
 * - No server queries — data is injected imperatively
 * - Draft support for editable parameters via drill-in view
 * - Ports derived from actual I/O keys (not from schema)
 * - Works with runnableBridge.forType("baseRunnable") generically
 */

import type {DataPath} from "@agenta/shared/utils"
import type {Atom, WritableAtom} from "jotai"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {getDefaultStore} from "jotai/vanilla"

import type {RevisionSchemaState} from "../appRevision/core"
import {
    completionServiceSchemaAtom,
    chatServiceSchemaAtom,
} from "../appRevision/state/serviceSchemaAtoms"
import {getSchemaPropertyAtPath} from "../legacyAppRevision/state/schemaAtoms"
import type {RunnableInputPort, RunnableOutputPort} from "../runnable/types"
import {extractVariablesFromConfig} from "../runnable/utils"
import type {EntitySchema, EntitySchemaProperty} from "../shared"
import type {BridgeQueryState} from "../shared/entityBridge"
import {generateLocalId} from "../shared/utils/helpers"

// ============================================================================
// TYPES
// ============================================================================

export interface BaseRunnableData {
    id: string
    label: string
    inputs: Record<string, unknown>
    outputs: unknown
    parameters: Record<string, unknown>
    /** Optional reference to the source entity */
    sourceRef?: {type: "application" | "evaluator"; id: string; slug?: string}
}

export interface CreateBaseRunnableParams {
    label: string
    inputs: Record<string, unknown>
    outputs: unknown
    parameters: Record<string, unknown>
    sourceRef?: BaseRunnableData["sourceRef"]
}

/**
 * Draft shape for the drill-in adapter.
 * Since the drill-in view operates on the parameters object directly,
 * the draft IS the updated parameters.
 */
export type BaseRunnableDraft = Record<string, unknown>

// ============================================================================
// ATOM FAMILIES
// ============================================================================

/**
 * Writable atom family holding BaseRunnableData.
 * Populated imperatively via `baseRunnableMolecule.set.data()`.
 */
const baseRunnableDataFamily = atomFamily((_id: string) => atom<BaseRunnableData | null>(null))

/**
 * Query state — always resolved (no server fetch).
 */
const baseRunnableQueryFamily = atomFamily((id: string) =>
    atom<BridgeQueryState>((get) => {
        const data = get(baseRunnableDataFamily(id))
        return {data, isPending: false, isError: false, error: null}
    }),
)

/**
 * Draft atom family — holds edited parameters (full replacement).
 */
const baseRunnableDraftFamily = atomFamily((_id: string) => atom<BaseRunnableDraft | null>(null))

/**
 * Merged data atom — applies draft parameters on top of base data.
 * Used by selectors.data (full entity for runnable bridge consumers).
 */
const baseRunnableMergedDataFamily = atomFamily((id: string) =>
    atom<BaseRunnableData | null>((get) => {
        const data = get(baseRunnableDataFamily(id))
        const draft = get(baseRunnableDraftFamily(id))
        if (!data) return null
        if (!draft) return data
        return {...data, parameters: draft}
    }),
)

/**
 * Parameters-only view atom — used by the drill-in adapter.
 * Returns merged parameters (base + draft) as a plain Record.
 * MoleculeDrillInFieldList calls getItemsAtPath(entity, path) on this,
 * so it only shows parameter keys.
 */
const baseRunnableParametersFamily = atomFamily((id: string) =>
    atom<BaseRunnableDraft | null>((get) => {
        const data = get(baseRunnableDataFamily(id))
        if (!data) return null
        const draft = get(baseRunnableDraftFamily(id))
        return draft ?? data.parameters
    }),
)

/**
 * isDirty — true when draft exists.
 */
const baseRunnableIsDirtyFamily = atomFamily((id: string) =>
    atom<boolean>((get) => get(baseRunnableDraftFamily(id)) !== null),
)

/**
 * Input ports derived from config template variables (e.g., {{country}}).
 * Falls back to the entity's `inputs` keys when no template variables found.
 */
const baseRunnableInputPortsFamily = atomFamily((id: string) =>
    atom<RunnableInputPort[]>((get) => {
        const data = get(baseRunnableMergedDataFamily(id))
        if (!data) return []

        // Primary: extract template variables from parameters config
        const dynamicKeys = extractVariablesFromConfig(data.parameters)
        if (dynamicKeys.length > 0) {
            return dynamicKeys.map((key) => ({
                key,
                name: key,
                type: "string",
                required: true,
            }))
        }

        // Fallback: derive from trace inputs keys
        if (!data.inputs) return []
        return Object.keys(data.inputs).map((key) => ({
            key,
            name: key,
            type: "string",
            required: false,
        }))
    }),
)

/**
 * Output ports derived from the entity's `outputs` keys.
 */
const baseRunnableOutputPortsFamily = atomFamily((id: string) =>
    atom<RunnableOutputPort[]>((get) => {
        const data = get(baseRunnableDataFamily(id))
        if (!data?.outputs || typeof data.outputs !== "object") return []
        return Object.keys(data.outputs as Record<string, unknown>).map((key) => ({
            key,
            name: key,
            type: "string",
        }))
    }),
)

/**
 * Detect if this is a chat variant by checking the INPUTS structure.
 *
 * Chat mode: inputs contain a `messages` array (conversation history)
 * Completion mode: inputs contain simple key-value pairs (template variables)
 *
 * We check inputs, NOT parameters, because the prompt config's `messages` field
 * exists in both modes (it's the prompt template).
 */
const baseRunnableIsChatFamily = atomFamily((id: string) =>
    atom<boolean>((get) => {
        const data = get(baseRunnableMergedDataFamily(id))
        if (!data) return false

        const inputs = data.inputs as Record<string, unknown> | null

        // Chat mode indicator: inputs contain a `messages` array with role/content objects
        if (inputs && "messages" in inputs && Array.isArray(inputs.messages)) {
            const msgs = inputs.messages as unknown[]
            const looksLikeChatMessages = msgs.some(
                (m) =>
                    m &&
                    typeof m === "object" &&
                    ("role" in (m as Record<string, unknown>) ||
                        "content" in (m as Record<string, unknown>)),
            )
            if (looksLikeChatMessages) {
                return true
            }
        }

        return false
    }),
)

/**
 * Request payload for baseRunnable execution.
 * Builds the ag_config from parameters for the /test endpoint.
 *
 * Uses the default service endpoints based on execution mode:
 * - Completion mode: /services/completion/test
 * - Chat mode: /services/chat/test
 */
const baseRunnableRequestPayloadFamily = atomFamily((id: string) =>
    atom((get) => {
        const data = get(baseRunnableMergedDataFamily(id))
        if (!data) return null

        const isChat = get(baseRunnableIsChatFamily(id))
        const params = data.parameters as Record<string, unknown>

        // Use the default service route based on execution mode
        const runtimePrefix = isChat ? "services/chat" : "services/completion"

        // Extract variables from parameters (input_keys from prompt configs)
        const variables: string[] = []
        for (const value of Object.values(params)) {
            if (value && typeof value === "object") {
                const nested = value as Record<string, unknown>
                if (Array.isArray(nested.input_keys)) {
                    for (const k of nested.input_keys) {
                        if (typeof k === "string" && !variables.includes(k)) {
                            variables.push(k)
                        }
                    }
                }
            }
        }

        // If no input_keys found, use the original inputs keys
        if (variables.length === 0 && data.inputs) {
            variables.push(...Object.keys(data.inputs))
        }

        // Build references from sourceRef for trace attribution
        const references: Record<string, {id?: string; slug?: string}> = {}
        if (data.sourceRef?.id) {
            const refType = data.sourceRef.type ?? "application"
            references[refType] = {
                id: data.sourceRef.id,
                ...(data.sourceRef.slug ? {slug: data.sourceRef.slug} : {}),
            }
        }

        return {
            ag_config: params,
            isChat,
            appType: isChat ? "chat" : "completion",
            invocationUrl: null, // Will be constructed from runtimePrefix + /test
            runtimePrefix,
            variables,
            spec: null,
            routePath: undefined,
            isCustom: false,
            appId: data.sourceRef?.id ?? null,
            // Include references for trace attribution
            references: Object.keys(references).length > 0 ? references : undefined,
        }
    }),
)

// ============================================================================
// SCHEMA ATOMS
// ============================================================================

/**
 * Schema query result shape matching SchemaQueryResult from schemaAtoms.
 */
interface BaseRunnableSchemaQueryResult {
    data: RevisionSchemaState
    isPending: boolean
    isError: boolean
    error: Error | null
}

const emptySchemaState: RevisionSchemaState = {
    openApiSchema: null,
    agConfigSchema: null,
    endpoints: {
        test: null,
        run: null,
        generate: null,
        generateDeployed: null,
        root: null,
    },
    availableEndpoints: [],
    isChatVariant: false,
}

/**
 * Schema query for baseRunnable — routes to the correct service schema
 * (chat or completion) based on the entity's detected execution mode.
 *
 * BaseRunnable has no per-revision URI, so it always uses the service schema
 * fast path. The isChat detection from baseRunnableIsChatFamily determines
 * which service schema to read.
 */
const baseRunnableSchemaQueryFamily = atomFamily((id: string) =>
    atom<BaseRunnableSchemaQueryResult>((get) => {
        const data = get(baseRunnableDataFamily(id))
        if (!data) {
            return {data: emptySchemaState, isPending: false, isError: false, error: null}
        }

        const isChat = get(baseRunnableIsChatFamily(id))
        const serviceQuery = get(isChat ? chatServiceSchemaAtom : completionServiceSchemaAtom)

        if (serviceQuery.isPending) {
            return {data: emptySchemaState, isPending: true, isError: false, error: null}
        }

        if (serviceQuery.isError || !serviceQuery.data) {
            return {
                data: emptySchemaState,
                isPending: false,
                isError: serviceQuery.isError,
                error: serviceQuery.error ?? null,
            }
        }

        return {data: serviceQuery.data, isPending: false, isError: false, error: null}
    }),
)

/**
 * agConfigSchema selector — extracts agConfigSchema from the service schema result.
 */
const baseRunnableAgConfigSchemaFamily = atomFamily((id: string) =>
    atom<EntitySchema | null>((get) => {
        const schemaQuery = get(baseRunnableSchemaQueryFamily(id))
        return schemaQuery.data?.agConfigSchema ?? null
    }),
)

/**
 * Schema at path selector — traverses schema tree for drill-in adapter support.
 */
const baseRunnableSchemaAtPathFamily = atomFamily(
    ({id, path}: {id: string; path: (string | number)[]}) =>
        atom<EntitySchemaProperty | null>((get) => {
            const agConfigSchema = get(baseRunnableAgConfigSchemaFamily(id))
            return getSchemaPropertyAtPath(agConfigSchema, path)
        }),
    (a, b) => a.id === b.id && JSON.stringify(a.path) === JSON.stringify(b.path),
)

/**
 * Server data for baseRunnable — the base (pre-draft) parameters.
 * For local entities, this is the originally injected data's parameters.
 * Named "serverData" for compatibility with PlaygroundConfigSection
 * which expects this atom shape.
 */
const baseRunnableServerDataParametersFamily = atomFamily((id: string) =>
    atom<BaseRunnableDraft | null>((get) => {
        const data = get(baseRunnableDataFamily(id))
        return data?.parameters ?? null
    }),
)

// ============================================================================
// REDUCERS
// ============================================================================

/**
 * Update reducer — replaces the draft parameters with the updated value.
 * The drill-in view provides the full updated parameters object via getChangesFromRoot.
 */
const updateBaseRunnableAtom: WritableAtom<
    unknown,
    [id: string, changes: BaseRunnableDraft],
    void
> = atom(null, (get, set, id: string, changes: BaseRunnableDraft) => {
    const data = get(baseRunnableDataFamily(id))
    if (!data) return
    set(baseRunnableDraftFamily(id), {...(data.parameters ?? {}), ...changes})
})

/**
 * Discard reducer — clears the draft for a given entity.
 */
const discardBaseRunnableAtom: WritableAtom<unknown, [id: string], void> = atom(
    null,
    (_get, set, id: string) => {
        set(baseRunnableDraftFamily(id), null)
    },
)

// ============================================================================
// MOLECULE
// ============================================================================

/**
 * Molecule satisfying both BaseMolecule (for runnable bridge) and
 * AdaptableMolecule (for MoleculeDrillInView).
 *
 * No server queries. Data is injected via `set.data()`.
 * Parameters are editable via the drill-in view.
 */
export const baseRunnableMolecule = {
    selectors: {
        data: (id: string): Atom<BaseRunnableData | null> => baseRunnableMergedDataFamily(id),
        query: (id: string): Atom<BridgeQueryState> => baseRunnableQueryFamily(id),
        isDirty: (id: string): Atom<boolean> => baseRunnableIsDirtyFamily(id),
        inputPorts: (id: string): Atom<RunnableInputPort[]> => baseRunnableInputPortsFamily(id),
        outputPorts: (id: string): Atom<RunnableOutputPort[]> => baseRunnableOutputPortsFamily(id),
        isChatVariant: (id: string): Atom<boolean> => baseRunnableIsChatFamily(id),
        schemaAtPath: (params: {
            id: string
            path: (string | number)[]
        }): Atom<EntitySchemaProperty | null> => baseRunnableSchemaAtPathFamily(params),
    },
    /**
     * Atom families for AdaptableMolecule interface (drill-in view).
     * `data` returns the parameters-only view so the drill-in field list
     * only shows parameter keys (not id, label, inputs, etc.).
     */
    atoms: {
        data: (id: string): Atom<BaseRunnableDraft | null> => baseRunnableParametersFamily(id),
        draft: (id: string): Atom<BaseRunnableDraft | null> => baseRunnableDraftFamily(id),
        isDirty: (id: string): Atom<boolean> => baseRunnableIsDirtyFamily(id),
        requestPayload: (id: string) => baseRunnableRequestPayloadFamily(id),
        /** Schema query (full state) — derived from service schema based on execution mode */
        schemaQuery: (id: string): Atom<BaseRunnableSchemaQueryResult> =>
            baseRunnableSchemaQueryFamily(id),
        /** ag_config schema from the matching service schema */
        agConfigSchema: (id: string): Atom<EntitySchema | null> =>
            baseRunnableAgConfigSchemaFamily(id),
        /** Base parameters (pre-draft) — "server data" equivalent for local entities */
        serverData: (id: string): Atom<BaseRunnableDraft | null> =>
            baseRunnableServerDataParametersFamily(id),
    },
    /** Reducers for AdaptableMolecule interface */
    reducers: {
        update: updateBaseRunnableAtom,
        discard: discardBaseRunnableAtom,
    },
    /** DrillIn configuration for MoleculeDrillInView */
    drillIn: {
        getRootData: (params: BaseRunnableDraft | null): unknown => params,
        getChangesFromRoot: (
            _params: BaseRunnableDraft | null,
            rootData: unknown,
            _path: DataPath,
        ): BaseRunnableDraft | null => {
            if (!rootData || typeof rootData !== "object") return null
            return rootData as BaseRunnableDraft
        },
        valueMode: "structured" as const,
    },
    set: {
        /** Imperatively write entity data into the store */
        data: (id: string, data: BaseRunnableData): void => {
            const store = getDefaultStore()
            store.set(baseRunnableDataFamily(id), data)
        },
    },
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a local-only base runnable entity from raw data.
 *
 * @example
 * ```typescript
 * const { id, data } = createBaseRunnable({
 *     label: "My Variant",
 *     inputs: { prompt: "Hello" },
 *     outputs: { response: "Hi" },
 *     parameters: { model: "gpt-4" },
 * })
 * baseRunnableMolecule.set.data(id, data)
 * ```
 */
export function createBaseRunnable(params: CreateBaseRunnableParams): {
    id: string
    data: BaseRunnableData
} {
    const id = generateLocalId("base-runnable")
    const data: BaseRunnableData = {
        id,
        label: params.label,
        inputs: params.inputs,
        outputs: params.outputs,
        parameters: params.parameters,
        sourceRef: params.sourceRef,
    }
    return {id, data}
}

// Auto-register snapshot adapter when this module is imported
// This ensures the adapter is available in the registry for snapshot operations
import "./snapshotAdapter"
export {baseRunnableSnapshotAdapter} from "./snapshotAdapter"
