/**
 * Evaluator Molecule
 *
 * Unified API for evaluator entity state management.
 * Follows the molecule pattern for consistency with other entities
 * (appRevision, testset, etc.).
 *
 * @example
 * ```typescript
 * import { evaluatorMolecule } from '@agenta/entities/evaluator'
 *
 * // Selectors (reactive)
 * const data = useAtomValue(evaluatorMolecule.selectors.data(evaluatorId))
 * const isDirty = useAtomValue(evaluatorMolecule.selectors.isDirty(evaluatorId))
 * const uri = useAtomValue(evaluatorMolecule.selectors.uri(evaluatorId))
 *
 * // Actions (write atoms)
 * const update = useSetAtom(evaluatorMolecule.actions.update)
 * update(evaluatorId, { data: { parameters: newParams } })
 *
 * // Imperative API (outside React)
 * const data = evaluatorMolecule.get.data(evaluatorId)
 * evaluatorMolecule.set.update(evaluatorId, { data: { parameters: newParams } })
 * ```
 *
 * @packageDocumentation
 */

import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"

import type {StoreOptions} from "../../shared"
import {parseEvaluatorKeyFromUri} from "../core"
import type {Evaluator} from "../core"

import {
    evaluatorProjectIdAtom,
    evaluatorsListQueryAtom,
    evaluatorsListDataAtom,
    nonArchivedEvaluatorsAtom,
    evaluatorQueryAtomFamily,
    evaluatorDraftAtomFamily,
    evaluatorEntityAtomFamily,
    evaluatorIsDirtyAtomFamily,
    updateEvaluatorDraftAtom,
    discardEvaluatorDraftAtom,
    invalidateEvaluatorsListCache,
    invalidateEvaluatorCache,
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
 * Evaluator data selector (returns merged server + draft data).
 */
const dataAtomFamily = atomFamily((evaluatorId: string) =>
    atom<Evaluator | null>((get) => get(evaluatorEntityAtomFamily(evaluatorId))),
)

/**
 * Evaluator query state selector (loading, error states).
 */
const queryAtomFamily = atomFamily((evaluatorId: string) =>
    atom((get) => {
        const query = get(evaluatorQueryAtomFamily(evaluatorId))
        return {
            data: query.data ?? null,
            isPending: query.isPending,
            isError: query.isError,
            error: query.error ?? null,
        }
    }),
)

/**
 * Evaluator URI selector.
 * Extracts URI from evaluator data (e.g., "agenta:builtin:auto_exact_match:v0").
 */
const uriAtomFamily = atomFamily((evaluatorId: string) =>
    atom<string | null>((get) => {
        const entity = get(evaluatorEntityAtomFamily(evaluatorId))
        return entity?.data?.uri ?? null
    }),
)

/**
 * Evaluator key selector.
 * Parses the evaluator key from the URI (e.g., "auto_exact_match").
 */
const evaluatorKeyAtomFamily = atomFamily((evaluatorId: string) =>
    atom<string | null>((get) => {
        const uri = get(uriAtomFamily(evaluatorId))
        return parseEvaluatorKeyFromUri(uri)
    }),
)

/**
 * Evaluator parameters selector.
 * Returns the configuration parameters (equivalent to legacy settings_values).
 */
const parametersAtomFamily = atomFamily((evaluatorId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(evaluatorEntityAtomFamily(evaluatorId))
        return entity?.data?.parameters ?? null
    }),
)

/**
 * Evaluator schemas selector.
 * Returns the JSON schemas for parameters, inputs, and outputs.
 */
const schemasAtomFamily = atomFamily((evaluatorId: string) =>
    atom((get) => {
        const entity = get(evaluatorEntityAtomFamily(evaluatorId))
        return entity?.data?.schemas ?? null
    }),
)

/**
 * Input schema selector (from data.schemas.inputs).
 */
const inputSchemaAtomFamily = atomFamily((evaluatorId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const schemas = get(schemasAtomFamily(evaluatorId))
        return (schemas?.inputs as Record<string, unknown> | null) ?? null
    }),
)

/**
 * Output schema selector (from data.schemas.outputs).
 */
const outputSchemaAtomFamily = atomFamily((evaluatorId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const schemas = get(schemasAtomFamily(evaluatorId))
        return (schemas?.outputs as Record<string, unknown> | null) ?? null
    }),
)

/**
 * Evaluator flags selector.
 */
const flagsAtomFamily = atomFamily((evaluatorId: string) =>
    atom((get) => {
        const entity = get(evaluatorEntityAtomFamily(evaluatorId))
        return entity?.flags ?? null
    }),
)

/**
 * Is custom evaluator (user-defined, not built-in).
 */
const isCustomAtomFamily = atomFamily((evaluatorId: string) =>
    atom<boolean>((get) => {
        const flags = get(flagsAtomFamily(evaluatorId))
        return flags?.is_custom ?? false
    }),
)

/**
 * Is human evaluator.
 */
const isHumanAtomFamily = atomFamily((evaluatorId: string) =>
    atom<boolean>((get) => {
        const flags = get(flagsAtomFamily(evaluatorId))
        return flags?.is_human ?? false
    }),
)

/**
 * Evaluator name selector.
 */
const nameAtomFamily = atomFamily((evaluatorId: string) =>
    atom<string | null>((get) => {
        const entity = get(evaluatorEntityAtomFamily(evaluatorId))
        return entity?.name ?? null
    }),
)

/**
 * Evaluator slug selector.
 */
const slugAtomFamily = atomFamily((evaluatorId: string) =>
    atom<string | null>((get) => {
        const entity = get(evaluatorEntityAtomFamily(evaluatorId))
        return entity?.slug ?? null
    }),
)

// ============================================================================
// MOLECULE DEFINITION
// ============================================================================

/**
 * Evaluator molecule — unified API for evaluator entity state.
 *
 * Follows the same pattern as `appRevisionMolecule` and `testsetMolecule`.
 */
export const evaluatorMolecule = {
    // ========================================================================
    // SELECTORS (reactive atom families — use with useAtomValue)
    // ========================================================================
    selectors: {
        /** Merged entity data (server + draft) */
        data: dataAtomFamily,
        /** Query state (loading, error) */
        query: queryAtomFamily,
        /** Is dirty (has local edits) */
        isDirty: evaluatorIsDirtyAtomFamily,
        /** Evaluator URI (e.g., "agenta:builtin:auto_exact_match:v0") */
        uri: uriAtomFamily,
        /** Evaluator key parsed from URI (e.g., "auto_exact_match") */
        evaluatorKey: evaluatorKeyAtomFamily,
        /** Configuration parameters (equivalent to legacy settings_values) */
        parameters: parametersAtomFamily,
        /** JSON schemas (parameters, inputs, outputs) */
        schemas: schemasAtomFamily,
        /** Input schema */
        inputSchema: inputSchemaAtomFamily,
        /** Output schema */
        outputSchema: outputSchemaAtomFamily,
        /** Evaluator flags */
        flags: flagsAtomFamily,
        /** Is custom evaluator */
        isCustom: isCustomAtomFamily,
        /** Is human evaluator */
        isHuman: isHumanAtomFamily,
        /** Evaluator name */
        name: nameAtomFamily,
        /** Evaluator slug */
        slug: slugAtomFamily,
    },

    // ========================================================================
    // ATOMS (raw store atoms — for advanced composition)
    // ========================================================================
    atoms: {
        /** Project ID atom */
        projectId: evaluatorProjectIdAtom,
        /** List query atom */
        listQuery: evaluatorsListQueryAtom,
        /** List data atom */
        listData: evaluatorsListDataAtom,
        /** Non-archived evaluators */
        nonArchived: nonArchivedEvaluatorsAtom,
        /** Per-entity query */
        query: evaluatorQueryAtomFamily,
        /** Per-entity draft */
        draft: evaluatorDraftAtomFamily,
        /** Per-entity merged data */
        entity: evaluatorEntityAtomFamily,
        /** Per-entity dirty flag */
        isDirty: evaluatorIsDirtyAtomFamily,
    },

    // ========================================================================
    // ACTIONS (write atoms — use with useSetAtom or set())
    // ========================================================================
    actions: {
        /** Update evaluator draft */
        update: updateEvaluatorDraftAtom,
        /** Discard evaluator draft */
        discard: discardEvaluatorDraftAtom,
    },

    // ========================================================================
    // GET (imperative read API — for callbacks outside React)
    // ========================================================================
    get: {
        data: (evaluatorId: string, options?: StoreOptions) =>
            getStore(options).get(evaluatorEntityAtomFamily(evaluatorId)),
        isDirty: (evaluatorId: string, options?: StoreOptions) =>
            getStore(options).get(evaluatorIsDirtyAtomFamily(evaluatorId)),
        uri: (evaluatorId: string, options?: StoreOptions) =>
            getStore(options).get(uriAtomFamily(evaluatorId)),
        evaluatorKey: (evaluatorId: string, options?: StoreOptions) =>
            getStore(options).get(evaluatorKeyAtomFamily(evaluatorId)),
        parameters: (evaluatorId: string, options?: StoreOptions) =>
            getStore(options).get(parametersAtomFamily(evaluatorId)),
        name: (evaluatorId: string, options?: StoreOptions) =>
            getStore(options).get(nameAtomFamily(evaluatorId)),
    },

    // ========================================================================
    // SET (imperative write API — for callbacks outside React)
    // ========================================================================
    set: {
        projectId: (projectId: string | null, options?: StoreOptions) =>
            getStore(options).set(evaluatorProjectIdAtom, projectId),
        update: (evaluatorId: string, updates: Partial<Evaluator>, options?: StoreOptions) =>
            getStore(options).set(updateEvaluatorDraftAtom, evaluatorId, updates),
        discard: (evaluatorId: string, options?: StoreOptions) =>
            getStore(options).set(discardEvaluatorDraftAtom, evaluatorId),
    },

    // ========================================================================
    // CACHE (invalidation utilities)
    // ========================================================================
    cache: {
        invalidateList: invalidateEvaluatorsListCache,
        invalidateDetail: invalidateEvaluatorCache,
    },
}

export type EvaluatorMolecule = typeof evaluatorMolecule
