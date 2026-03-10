/**
 * LegacyEvaluator Molecule
 *
 * Unified API for LegacyEvaluator entity state management.
 * Follows the molecule pattern for consistency with other entities
 * (evaluator, appRevision, testset, etc.).
 *
 * Uses the SimpleEvaluator backend API (`/preview/simple/evaluators/`).
 *
 * @example
 * ```typescript
 * import { legacyEvaluatorMolecule } from '@agenta/entities/legacyEvaluator'
 *
 * // Selectors (reactive)
 * const data = useAtomValue(legacyEvaluatorMolecule.selectors.data(evaluatorId))
 * const isDirty = useAtomValue(legacyEvaluatorMolecule.selectors.isDirty(evaluatorId))
 * const uri = useAtomValue(legacyEvaluatorMolecule.selectors.uri(evaluatorId))
 *
 * // Actions (write atoms)
 * const update = useSetAtom(legacyEvaluatorMolecule.actions.update)
 * update(evaluatorId, { data: { parameters: newParams } })
 *
 * // Imperative API (outside React)
 * const data = legacyEvaluatorMolecule.get.data(evaluatorId)
 * legacyEvaluatorMolecule.set.update(evaluatorId, { data: { parameters: newParams } })
 * ```
 *
 * @packageDocumentation
 */

import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"

import type {StoreOptions} from "../../shared"
import {parseEvaluatorKeyFromUri} from "../core"
import type {LegacyEvaluator} from "../core"

import {
    legacyEvaluatorProjectIdAtom,
    legacyEvaluatorsListQueryAtom,
    legacyEvaluatorsListDataAtom,
    nonArchivedLegacyEvaluatorsAtom,
    legacyEvaluatorQueryAtomFamily,
    legacyEvaluatorDraftAtomFamily,
    legacyEvaluatorEntityAtomFamily,
    legacyEvaluatorIsDirtyAtomFamily,
    updateLegacyEvaluatorDraftAtom,
    discardLegacyEvaluatorDraftAtom,
    invalidateLegacyEvaluatorsListCache,
    invalidateLegacyEvaluatorCache,
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
    atom<LegacyEvaluator | null>((get) => get(legacyEvaluatorEntityAtomFamily(evaluatorId))),
)

/**
 * Evaluator query state selector (loading, error states).
 */
const queryAtomFamily = atomFamily((evaluatorId: string) =>
    atom((get) => {
        const query = get(legacyEvaluatorQueryAtomFamily(evaluatorId))
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
 */
const uriAtomFamily = atomFamily((evaluatorId: string) =>
    atom<string | null>((get) => {
        const entity = get(legacyEvaluatorEntityAtomFamily(evaluatorId))
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
 */
const parametersAtomFamily = atomFamily((evaluatorId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(legacyEvaluatorEntityAtomFamily(evaluatorId))
        return entity?.data?.parameters ?? null
    }),
)

/**
 * Evaluator schemas selector.
 */
const schemasAtomFamily = atomFamily((evaluatorId: string) =>
    atom((get) => {
        const entity = get(legacyEvaluatorEntityAtomFamily(evaluatorId))
        return entity?.data?.schemas ?? null
    }),
)

/**
 * Input schema selector.
 */
const inputSchemaAtomFamily = atomFamily((evaluatorId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const schemas = get(schemasAtomFamily(evaluatorId))
        return (schemas?.inputs as Record<string, unknown> | null) ?? null
    }),
)

/**
 * Output schema selector.
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
        const entity = get(legacyEvaluatorEntityAtomFamily(evaluatorId))
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
        const entity = get(legacyEvaluatorEntityAtomFamily(evaluatorId))
        return entity?.name ?? null
    }),
)

/**
 * Evaluator slug selector.
 */
const slugAtomFamily = atomFamily((evaluatorId: string) =>
    atom<string | null>((get) => {
        const entity = get(legacyEvaluatorEntityAtomFamily(evaluatorId))
        return entity?.slug ?? null
    }),
)

// ============================================================================
// MOLECULE DEFINITION
// ============================================================================

/**
 * LegacyEvaluator molecule — unified API for evaluator entity state.
 *
 * Uses the SimpleEvaluator backend API (`/preview/simple/evaluators/`).
 * Follows the same pattern as `evaluatorMolecule` and `appRevisionMolecule`.
 */
export const legacyEvaluatorMolecule = {
    // ========================================================================
    // SELECTORS (reactive atom families — use with useAtomValue)
    // ========================================================================
    selectors: {
        /** Merged entity data (server + draft) */
        data: dataAtomFamily,
        /** Query state (loading, error) */
        query: queryAtomFamily,
        /** Is dirty (has local edits) */
        isDirty: legacyEvaluatorIsDirtyAtomFamily,
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
        projectId: legacyEvaluatorProjectIdAtom,
        /** List query atom */
        listQuery: legacyEvaluatorsListQueryAtom,
        /** List data atom */
        listData: legacyEvaluatorsListDataAtom,
        /** Non-archived evaluators */
        nonArchived: nonArchivedLegacyEvaluatorsAtom,
        /** Per-entity query */
        query: legacyEvaluatorQueryAtomFamily,
        /** Per-entity draft */
        draft: legacyEvaluatorDraftAtomFamily,
        /** Per-entity merged data */
        entity: legacyEvaluatorEntityAtomFamily,
        /** Per-entity dirty flag */
        isDirty: legacyEvaluatorIsDirtyAtomFamily,
    },

    // ========================================================================
    // ACTIONS (write atoms — use with useSetAtom or set())
    // ========================================================================
    actions: {
        /** Update evaluator draft */
        update: updateLegacyEvaluatorDraftAtom,
        /** Discard evaluator draft */
        discard: discardLegacyEvaluatorDraftAtom,
    },

    // ========================================================================
    // GET (imperative read API — for callbacks outside React)
    // ========================================================================
    get: {
        data: (evaluatorId: string, options?: StoreOptions) =>
            getStore(options).get(legacyEvaluatorEntityAtomFamily(evaluatorId)),
        isDirty: (evaluatorId: string, options?: StoreOptions) =>
            getStore(options).get(legacyEvaluatorIsDirtyAtomFamily(evaluatorId)),
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
            getStore(options).set(legacyEvaluatorProjectIdAtom, projectId),
        update: (evaluatorId: string, updates: Partial<LegacyEvaluator>, options?: StoreOptions) =>
            getStore(options).set(updateLegacyEvaluatorDraftAtom, evaluatorId, updates),
        discard: (evaluatorId: string, options?: StoreOptions) =>
            getStore(options).set(discardLegacyEvaluatorDraftAtom, evaluatorId),
    },

    // ========================================================================
    // CACHE (invalidation utilities)
    // ========================================================================
    cache: {
        invalidateList: invalidateLegacyEvaluatorsListCache,
        invalidateDetail: invalidateLegacyEvaluatorCache,
    },
}

export type LegacyEvaluatorMolecule = typeof legacyEvaluatorMolecule
