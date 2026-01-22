/**
 * Cascading Selection Atoms
 *
 * Derived state for cascading app revision selection (App → Variant → Revision).
 * Auto-selection logic lives here in the data layer, not in React components.
 *
 * ## Pattern
 *
 * User explicitly selects App and Variant. When there's only one item at a level,
 * the "effective" selection is automatically derived:
 *
 * - effectiveVariantId: user selection OR auto-select if single variant
 * - autoCompletedSelection: full selection if single revision at final level
 *
 * ## Usage
 *
 * ```typescript
 * import { cascadingSelection } from '@agenta/playground/state'
 *
 * // In component - read derived state
 * const effectiveVariantId = useAtomValue(cascadingSelection.selectors.effectiveVariantId)
 * const autoCompleted = useAtomValue(cascadingSelection.selectors.autoCompletedSelection)
 *
 * // Set user selections
 * const setAppId = useSetAtom(cascadingSelection.atoms.userSelectedAppId)
 * const setVariantId = useSetAtom(cascadingSelection.atoms.userSelectedVariantId)
 * ```
 */

import {
    appRevisionMolecule,
    type AppListItem,
    type VariantListItem,
    type RevisionListItem,
} from "@agenta/entities/appRevision"
import {atom, type PrimitiveAtom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {EntitySelection} from "../types"

// ============================================================================
// QUERY STATE TYPES
// ============================================================================

/**
 * Loading state for a data level in the selection hierarchy
 */
export interface SelectionLevelLoadingState {
    isPending: boolean
    isError: boolean
    error: Error | null
}

// ============================================================================
// USER SELECTION STATE (explicit user choices)
// ============================================================================

/**
 * User's explicit app selection (null = nothing selected)
 */
export const userSelectedAppIdAtom = atom<string | null>(null) as PrimitiveAtom<string | null>

/**
 * User's explicit variant selection (null = nothing selected)
 */
export const userSelectedVariantIdAtom = atom<string | null>(null) as PrimitiveAtom<string | null>

/**
 * Reset both selections (e.g., when modal closes)
 */
export const resetCascadingSelectionAtom = atom(null, (_get, set) => {
    set(userSelectedAppIdAtom, null)
    set(userSelectedVariantIdAtom, null)
})

// ============================================================================
// DERIVED DATA LISTS
// ============================================================================

/**
 * Apps list (from entity layer)
 */
export const appsAtom = appRevisionMolecule.selectors.apps

/**
 * Variants for selected app (empty if no app selected)
 */
export const variantsForSelectedAppAtom = atom((get) => {
    const appId = get(userSelectedAppIdAtom)
    if (!appId) return [] as VariantListItem[]
    return get(appRevisionMolecule.selectors.variantsByApp(appId)) as VariantListItem[]
})

/**
 * Revisions for effective variant (empty if no variant determined)
 */
export const revisionsForEffectiveVariantAtom = atom((get) => {
    const variantId = get(effectiveVariantIdAtom)
    if (!variantId) return [] as RevisionListItem[]
    return get(appRevisionMolecule.selectors.revisions(variantId)) as RevisionListItem[]
})

// ============================================================================
// QUERY STATE ATOMS (for loading/error indicators)
// ============================================================================

/**
 * Apps query state - provides loading/error information
 */
export const appsQueryStateAtom = atom<SelectionLevelLoadingState>((get) => {
    const query = get(appRevisionMolecule.selectors.appsQuery)
    return {
        isPending: query.isPending ?? false,
        isError: query.isError ?? false,
        error: (query.error as Error) ?? null,
    }
})

/**
 * Variants query state for selected app
 * Returns idle state (not loading, no error) if no app selected
 */
export const variantsQueryStateAtom = atom<SelectionLevelLoadingState>((get) => {
    const appId = get(userSelectedAppIdAtom)
    if (!appId) {
        return {isPending: false, isError: false, error: null}
    }

    const query = get(appRevisionMolecule.selectors.variantsQuery(appId))
    return {
        isPending: query.isPending ?? false,
        isError: query.isError ?? false,
        error: (query.error as Error) ?? null,
    }
})

/**
 * Revisions query state for effective variant
 * Returns idle state if no variant determined
 */
export const revisionsQueryStateAtom = atom<SelectionLevelLoadingState>((get) => {
    const variantId = get(effectiveVariantIdAtom)
    if (!variantId) {
        return {isPending: false, isError: false, error: null}
    }

    const query = get(appRevisionMolecule.selectors.revisionsQuery(variantId))
    return {
        isPending: query.isPending ?? false,
        isError: query.isError ?? false,
        error: (query.error as Error) ?? null,
    }
})

/**
 * Variants query state atom family (for direct access by appId)
 */
export const variantsQueryStateAtomFamily = atomFamily((appId: string) =>
    atom<SelectionLevelLoadingState>((get) => {
        if (!appId) {
            return {isPending: false, isError: false, error: null}
        }

        const query = get(appRevisionMolecule.selectors.variantsQuery(appId))
        return {
            isPending: query.isPending ?? false,
            isError: query.isError ?? false,
            error: (query.error as Error) ?? null,
        }
    }),
)

/**
 * Revisions query state atom family (for direct access by variantId)
 */
export const revisionsQueryStateAtomFamily = atomFamily((variantId: string) =>
    atom<SelectionLevelLoadingState>((get) => {
        if (!variantId) {
            return {isPending: false, isError: false, error: null}
        }

        const query = get(appRevisionMolecule.selectors.revisionsQuery(variantId))
        return {
            isPending: query.isPending ?? false,
            isError: query.isError ?? false,
            error: (query.error as Error) ?? null,
        }
    }),
)

/**
 * Combined loading state - true if any level is loading
 */
export const isAnyLevelLoadingAtom = atom((get) => {
    const appsState = get(appsQueryStateAtom)
    const variantsState = get(variantsQueryStateAtom)
    const revisionsState = get(revisionsQueryStateAtom)

    return appsState.isPending || variantsState.isPending || revisionsState.isPending
})

/**
 * Combined error state - returns first error found
 */
export const combinedErrorAtom = atom<Error | null>((get) => {
    const appsState = get(appsQueryStateAtom)
    if (appsState.isError) return appsState.error

    const variantsState = get(variantsQueryStateAtom)
    if (variantsState.isError) return variantsState.error

    const revisionsState = get(revisionsQueryStateAtom)
    if (revisionsState.isError) return revisionsState.error

    return null
})

// ============================================================================
// AUTO-SELECTION DERIVATION
// ============================================================================

/**
 * Effective variant ID: user selection OR auto-select if single variant
 *
 * When user selects an app that has only one variant, this automatically
 * "selects" that variant without user interaction.
 */
export const effectiveVariantIdAtom = atom((get) => {
    // If user explicitly selected a variant, use it
    const userVariantId = get(userSelectedVariantIdAtom)
    if (userVariantId) return userVariantId

    // If user selected an app and it has exactly one variant, auto-select
    const appId = get(userSelectedAppIdAtom)
    if (!appId) return null

    const variants = get(variantsForSelectedAppAtom)
    if (variants.length === 1) {
        return variants[0].id
    }

    return null
})

/**
 * Whether the variant was auto-selected (vs user-selected)
 */
export const isVariantAutoSelectedAtom = atom((get) => {
    const userVariantId = get(userSelectedVariantIdAtom)
    const effectiveVariantId = get(effectiveVariantIdAtom)
    return effectiveVariantId !== null && userVariantId === null
})

/**
 * Effective revision ID: auto-select if single revision at variant level
 *
 * This is only for auto-completion - we don't store user revision selection
 * since selecting a revision completes the flow.
 */
export const autoSelectedRevisionIdAtom = atom((get) => {
    const variantId = get(effectiveVariantIdAtom)
    if (!variantId) return null

    const revisions = get(revisionsForEffectiveVariantAtom)
    if (revisions.length === 1) {
        return revisions[0].id
    }

    return null
})

// ============================================================================
// SELECTED ENTITY DATA
// ============================================================================

/**
 * Selected app data
 */
export const selectedAppAtom = atom((get) => {
    const appId = get(userSelectedAppIdAtom)
    if (!appId) return null
    const apps = get(appsAtom) as AppListItem[]
    return apps.find((app) => app.id === appId) ?? null
})

/**
 * Selected variant data (from effective variant ID)
 */
export const selectedVariantAtom = atom((get) => {
    const variantId = get(effectiveVariantIdAtom)
    if (!variantId) return null
    const variants = get(variantsForSelectedAppAtom)
    return variants.find((v) => v.id === variantId) ?? null
})

/**
 * Auto-selected revision data
 */
export const autoSelectedRevisionAtom = atom((get) => {
    const revisionId = get(autoSelectedRevisionIdAtom)
    if (!revisionId) return null
    const revisions = get(revisionsForEffectiveVariantAtom)
    return revisions.find((r) => r.id === revisionId) ?? null
})

// ============================================================================
// AUTO-COMPLETED SELECTION
// ============================================================================

/**
 * Auto-completed selection: full EntitySelection if all levels auto-complete
 *
 * Returns a complete selection when:
 * - User selected an app
 * - Variant was determined (user or auto-selected)
 * - There's exactly one revision (auto-completed)
 *
 * Returns null if any level requires user input.
 */
export const autoCompletedSelectionAtom = atom<EntitySelection | null>((get) => {
    const app = get(selectedAppAtom)
    const variant = get(selectedVariantAtom)
    const revision = get(autoSelectedRevisionAtom)

    // All three levels must be determined for auto-completion
    if (!app || !variant || !revision) return null

    return {
        type: "appRevision",
        id: revision.id,
        label: `${app.name} / ${variant.name} / v${revision.version}`,
        metadata: {
            appId: app.id,
            appName: app.name,
            variantId: variant.id,
            variantName: variant.name,
        },
    }
})

/**
 * Whether the selection can be auto-completed
 */
export const canAutoCompleteAtom = atom((get) => {
    return get(autoCompletedSelectionAtom) !== null
})

// ============================================================================
// SELECTION STATE SUMMARY
// ============================================================================

/**
 * Current selection state for UI display
 */
export const selectionStateAtom = atom((get) => {
    const appId = get(userSelectedAppIdAtom)
    const effectiveVariantId = get(effectiveVariantIdAtom)
    const isVariantAutoSelected = get(isVariantAutoSelectedAtom)
    const autoCompletedSelection = get(autoCompletedSelectionAtom)

    return {
        appId,
        effectiveVariantId,
        isVariantAutoSelected,
        hasAutoCompletedSelection: autoCompletedSelection !== null,
        canSelectVariant: appId !== null,
        canSelectRevision: effectiveVariantId !== null,
    }
})

// ============================================================================
// ACTION: SET APP (RESETS VARIANT)
// ============================================================================

/**
 * Set app ID and reset variant selection
 *
 * When user changes app, the variant selection should reset since
 * the available variants change.
 */
export const setAppIdAtom = atom(null, (_get, set, appId: string | null) => {
    set(userSelectedAppIdAtom, appId)
    set(userSelectedVariantIdAtom, null) // Reset variant when app changes
})

// ============================================================================
// CASCADING SELECTION MOLECULE
// ============================================================================

/**
 * Cascading selection molecule for app revision selection
 *
 * @example
 * ```typescript
 * // Read derived state
 * const effectiveVariantId = useAtomValue(cascadingSelection.selectors.effectiveVariantId)
 * const autoCompleted = useAtomValue(cascadingSelection.selectors.autoCompletedSelection)
 *
 * // Check auto-selection status
 * const isVariantAutoSelected = useAtomValue(cascadingSelection.selectors.isVariantAutoSelected)
 *
 * // Set user selections
 * const setAppId = useSetAtom(cascadingSelection.actions.setAppId)
 * const setVariantId = useSetAtom(cascadingSelection.atoms.userSelectedVariantId)
 *
 * // Reset on modal close
 * const reset = useSetAtom(cascadingSelection.actions.reset)
 * ```
 */
export const cascadingSelection = {
    /**
     * Raw state atoms (for direct read/write)
     */
    atoms: {
        userSelectedAppId: userSelectedAppIdAtom,
        userSelectedVariantId: userSelectedVariantIdAtom,
    },

    /**
     * Derived selectors (read-only)
     */
    selectors: {
        // Data lists
        apps: appsAtom,
        variantsForSelectedApp: variantsForSelectedAppAtom,
        revisionsForEffectiveVariant: revisionsForEffectiveVariantAtom,

        // Effective IDs (with auto-selection)
        effectiveVariantId: effectiveVariantIdAtom,
        autoSelectedRevisionId: autoSelectedRevisionIdAtom,

        // Auto-selection status
        isVariantAutoSelected: isVariantAutoSelectedAtom,
        canAutoComplete: canAutoCompleteAtom,

        // Selected entity data
        selectedApp: selectedAppAtom,
        selectedVariant: selectedVariantAtom,
        autoSelectedRevision: autoSelectedRevisionAtom,

        // Complete auto-completed selection
        autoCompletedSelection: autoCompletedSelectionAtom,

        // Summary state
        selectionState: selectionStateAtom,
    },

    /**
     * Query state selectors (for loading/error indicators)
     */
    queryState: {
        // Level-specific query states (derived from current selection)
        apps: appsQueryStateAtom,
        variants: variantsQueryStateAtom,
        revisions: revisionsQueryStateAtom,

        // Query state atom families (for direct access by ID)
        variantsByAppId: variantsQueryStateAtomFamily,
        revisionsByVariantId: revisionsQueryStateAtomFamily,

        // Combined states
        isAnyLoading: isAnyLevelLoadingAtom,
        combinedError: combinedErrorAtom,
    },

    /**
     * Actions (write operations)
     */
    actions: {
        setAppId: setAppIdAtom,
        reset: resetCascadingSelectionAtom,
    },
}
