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

import type {StoreOptions} from "../../shared"
import {isLocalDraftId, isPlaceholderId} from "../../shared"
import type {Workflow} from "../core"
import {parseWorkflowKeyFromUri} from "../core/schema"

import {
    workflowProjectIdAtom,
    workflowsListQueryAtom,
    workflowsListDataAtom,
    nonArchivedWorkflowsAtom,
    workflowQueryAtomFamily,
    workflowInspectAtomFamily,
    workflowAppSchemaAtomFamily,
    workflowDraftAtomFamily,
    workflowEntityAtomFamily,
    workflowLocalServerDataAtomFamily,
    workflowIsDirtyAtomFamily,
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
        /** Workflow URI (e.g., "agenta:builtin:auto_exact_match:v0") */
        uri: uriAtomFamily,
        /** Workflow key parsed from URI (e.g., "auto_exact_match") */
        workflowKey: workflowKeyAtomFamily,
        /** Configuration parameters */
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
        /** Workflow name */
        name: nameAtomFamily,
        /** Workflow slug */
        slug: slugAtomFamily,
    },

    // ========================================================================
    // ATOMS (raw store atoms — for advanced composition)
    // ========================================================================
    atoms: {
        /** Project ID atom */
        projectId: workflowProjectIdAtom,
        /** List query atom */
        listQuery: workflowsListQueryAtom,
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
        /** Per-entity draft */
        draft: workflowDraftAtomFamily,
        /** Per-entity merged data */
        entity: workflowEntityAtomFamily,
        /** Per-entity dirty flag */
        isDirty: workflowIsDirtyAtomFamily,
    },

    // ========================================================================
    // ACTIONS (write atoms — use with useSetAtom or set())
    // ========================================================================
    actions: {
        /** Update workflow draft */
        update: updateWorkflowDraftAtom,
        /** Discard workflow draft */
        discard: discardWorkflowDraftAtom,
    },

    // ========================================================================
    // GET (imperative read API — for callbacks outside React)
    // ========================================================================
    get: {
        data: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(workflowEntityAtomFamily(workflowId)),
        isDirty: (workflowId: string, options?: StoreOptions) =>
            getStore(options).get(workflowIsDirtyAtomFamily(workflowId)),
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
    },

    // ========================================================================
    // CACHE (invalidation utilities)
    // ========================================================================
    cache: {
        invalidateList: invalidateWorkflowsListCache,
        invalidateDetail: invalidateWorkflowCache,
    },
}

export type WorkflowMolecule = typeof workflowMolecule
