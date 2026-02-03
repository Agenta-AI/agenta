/**
 * Legacy Entity Bridge
 *
 * Bridges the existing OSS playground state with the ossAppRevision entity
 * from @agenta/entities. This enables progressive migration from scattered atoms
 * to the unified molecule pattern.
 *
 * Architecture (Single Source of Truth):
 * 1. Server data flows: OSS queries → molecule.serverData
 * 2. Enhanced prompts derived: spec + serverData → molecule.enhancedPrompts
 * 3. UI mutations flow: component → molecule.reducers.updateProperty
 * 4. Reads derive from: molecule.atoms.data → promptsAtomFamily (read-only)
 *
 * This eliminates intermediate state by making the molecule the single source of truth
 * for all revision-related data.
 *
 * Usage:
 * ```typescript
 * // In Playground component initialization
 * import { useLegacyEntityBridge } from '@/oss/state/newPlayground/legacyEntityBridge'
 *
 * function Playground() {
 *   // Bridge syncs existing playground state to molecule
 *   useLegacyEntityBridge()
 *   // ... rest of playground
 * }
 * ```
 */

import {useEffect} from "react"

import {
    ossAppRevisionMolecule,
    createLocalDraftFromRevision,
    discardLocalDraft as discardEntityLocalDraft,
    localDraftIdsAtom,
    localDraftsListAtom,
    hasUnsavedLocalDraftsAtom,
    setRevisionVariantContextAtom,
    revisionEnhancedCustomPropertiesAtomFamily,
    revisionEnhancedPromptsAtomFamily,
    type OssAppRevisionData,
} from "@agenta/entities/ossAppRevision"
import {
    extractSourceIdFromDraft,
    isLocalDraftId,
    getVersionLabel,
    formatLocalDraftLabel,
    type RevisionLabelInfo,
} from "@agenta/entities/shared"
import {useAtomValue, useSetAtom} from "jotai"
import {atom, getDefaultStore} from "jotai"
import {atomFamily as atomFamilyJotaiUtils} from "jotai/utils"
import {atomFamily} from "jotai-family"

import {revisionDeploymentAtomFamily} from "@/oss/state/variant/atoms/fetcher"
import {revisionListAtom} from "@/oss/state/variant/selectors/variant"

// Bridge initialization flag for debug utilities
let bridgeInitialized = false

// ============================================================================
// REVISION DATA ADAPTER
// Transforms enhanced variant revision to ossAppRevision data format
// ============================================================================

/**
 * Transform an enhanced revision from OSS format to ossAppRevision format.
 */
export function adaptRevisionToLegacyFormat(
    revision: any,
    variant?: any,
): OssAppRevisionData | null {
    if (!revision) return null

    return {
        id: revision.id,
        variantId: revision.variantId,
        appId: revision.appId || variant?.appId || revision.app_id,
        revision: revision.revision,
        isLatestRevision: revision.isLatestRevision ?? false,
        variantName: revision.variantName || variant?.variantName,
        appName: revision.appName || variant?.appName,
        configName: revision.configName,
        parameters: revision.parameters || revision.config?.parameters,
        uri: revision.uri || variant?.uri,
        createdAt: revision.createdAt,
        updatedAt: revision.updatedAt,
        modifiedById: revision.modifiedById || revision.modified_by_id,
        commitMessage: revision.commitMessage,
    }
}

/**
 * Atom family that provides ossAppRevision-formatted data for a revision.
 * This reads from existing OSS atoms and transforms to the new format.
 */
export const legacyRevisionDataAdapterAtomFamily = atomFamilyJotaiUtils((revisionId: string) =>
    atom<OssAppRevisionData | null>((get) => {
        // Find the variant that contains this revision
        const variants = get(variantsAtom)
        if (!variants) return null

        for (const variant of variants) {
            const revisions = get(revisionsByVariantIdAtomFamily((variant as any).variantId))
            const revision = revisions?.find((r: any) => r.id === revisionId)
            if (revision) {
                return adaptRevisionToLegacyFormat(revision, variant)
            }
        }

        return null
    }),
)

// Debug logging (only in development)
const DEBUG = process.env.NODE_ENV !== "production"

// ============================================================================
// VARIANT CONTEXT HOOK
// ============================================================================

/**
 * Hook to set variant context for a revision.
 * This is kept for backward compatibility but the entity package now
 * fetches URI directly via fetchOssRevisionById.
 *
 * @param revisionId - The revision ID to set context for
 */
export function useSetRevisionVariantContext(revisionId: string | null): void {
    // Subscribe to revisionListAtom which contains all revisions with their variantId
    // This ensures the effect re-runs when revisions are loaded (fixes race condition)
    const revisions = useAtomValue(revisionListAtom)
    const setVariantContext = useSetAtom(setRevisionVariantContextAtom)

    useEffect(() => {
        if (!revisionId || !revisions || revisions.length === 0) return

        // Find the revision in the list - it already has variantId populated
        const revision = revisions.find((r: any) => r.id === revisionId)
        if (revision && (revision as any).variantId) {
            const variantId = (revision as any).variantId

            // Set variant context in the entity package
            setVariantContext(revisionId, variantId)

            // Also update any existing server data that was seeded without variantId
            // This fixes the race condition where initial seeding happens before this hook runs
            // Use bridgeServerData (the underlying atom) not serverData (the selector)
            const store = getDefaultStore()
            const existingServerData = store.get(
                ossAppRevisionMolecule.atoms.bridgeServerData(revisionId),
            )
            if (existingServerData && !existingServerData.variantId) {
                store.set(ossAppRevisionMolecule.actions.setServerData, revisionId, {
                    ...existingServerData,
                    variantId,
                })
            }

            // Also update any existing draft that was created without variantId
            const existingDraft = store.get(ossAppRevisionMolecule.atoms.draft(revisionId))
            if (existingDraft && !existingDraft.variantId) {
                store.set(ossAppRevisionMolecule.actions.update, revisionId, {variantId})
            }
        }
    }, [revisionId, revisions, setVariantContext])
}

// ============================================================================
// MOLECULE ACCESS HELPERS
// ============================================================================

/**
 * Get the ossAppRevision molecule.
 * This is the recommended way to access the molecule in components.
 */
export {ossAppRevisionMolecule}

/**
 * Re-export commonly used molecule APIs for convenience.
 */
export const ossRevision = {
    /**
     * Atoms for reactive subscriptions (use with useAtomValue)
     */
    atoms: ossAppRevisionMolecule.atoms,

    /**
     * Selectors for derived state (use with useAtomValue)
     */
    selectors: ossAppRevisionMolecule.selectors,

    /**
     * Reducers for mutations (use with useSetAtom)
     */
    reducers: ossAppRevisionMolecule.reducers,

    /**
     * Imperative getters (for callbacks)
     */
    get: ossAppRevisionMolecule.get,

    /**
     * Imperative setters (for callbacks)
     */
    set: ossAppRevisionMolecule.set,
}

// ============================================================================
// DEBUG UTILITIES
// These can be called from browser console: window.__legacyEntityBridge
// ============================================================================

/**
 * Debug utilities for inspecting bridge state from browser console.
 * Access via: window.__legacyEntityBridge
 */
export const debugBridge = {
    /**
     * Check if bridge is initialized
     */
    isInitialized: () => bridgeInitialized,

    /**
     * Get molecule data for a revision
     */
    getMoleculeData: (revisionId: string) => {
        return ossAppRevisionMolecule.get.data(revisionId)
    },

    /**
     * Get molecule server data for a revision
     */
    getServerData: (revisionId: string) => {
        return ossAppRevisionMolecule.get.serverData(revisionId)
    },

    /**
     * Get molecule draft for a revision
     */
    getDraft: (revisionId: string) => {
        return ossAppRevisionMolecule.get.draft(revisionId)
    },

    /**
     * Check if revision has unsaved changes
     */
    isDirty: (revisionId: string) => {
        return ossAppRevisionMolecule.get.isDirty(revisionId)
    },

    /**
     * Log full molecule state for a revision
     */
    inspect: (revisionId: string) => {
        const data = ossAppRevisionMolecule.get.data(revisionId)
        const serverData = ossAppRevisionMolecule.get.serverData(revisionId)
        const draft = ossAppRevisionMolecule.get.draft(revisionId)
        const isDirty = ossAppRevisionMolecule.get.isDirty(revisionId)

        console.group(`[LegacyEntityBridge] Inspect revision: ${revisionId}`)
        console.log("Data (merged):", data)
        console.log("Server Data:", serverData)
        console.log("Draft:", draft)
        console.log("Is Dirty:", isDirty)
        console.groupEnd()

        return {data, serverData, draft, isDirty}
    },
}

// Expose debug utilities to window in development
if (typeof window !== "undefined" && DEBUG) {
    ;(window as any).__legacyEntityBridge = debugBridge
    console.log("🔧 Debug utilities available at window.__legacyEntityBridge")
}

// ============================================================================
// DROP-IN REPLACEMENT SELECTORS
// These provide similar interface to existing atoms but use molecule data
// ============================================================================

/**
 * Molecule-backed variant/revision lookup by ID.
 *
 * This is a drop-in replacement for variantByRevisionIdAtomFamily that:
 * 1. First checks if molecule has data (populated via useSyncRevisionToMolecule)
 * 2. Falls back to legacy revisionListAtom lookup
 *
 * Benefits:
 * - Returns molecule data which includes draft state when available
 * - Provides consistent interface during migration
 * - Gradually enables molecule features without breaking existing code
 *
 * Usage (same as variantByRevisionIdAtomFamily):
 * ```typescript
 * const variant = useAtomValue(moleculeBackedVariantAtomFamily(revisionId))
 * ```
 */
export const moleculeBackedVariantAtomFamily = atomFamilyJotaiUtils((revisionId: string) =>
    atom((get) => {
        // Try molecule first (has draft merged)
        const moleculeData = get(ossAppRevisionMolecule.atoms.data(revisionId))

        // Also get legacy revision data for fallback fields (e.g., variantName)
        const revisions = get(revisionListAtom) || []
        const legacyRevision = revisions.find((r: any) => r.id === revisionId) as any

        if (moleculeData) {
            // Transform molecule data back to legacy format for compatibility
            // Merge with legacy revision data for fields that may be missing (e.g., variantId/name)
            return {
                id: moleculeData.id,
                variantId: moleculeData.variantId ?? legacyRevision?.variantId,
                appId: moleculeData.appId ?? legacyRevision?.appId,
                revision: moleculeData.revision ?? legacyRevision?.revision,
                isLatestRevision: moleculeData.isLatestRevision ?? legacyRevision?.isLatestRevision,
                variantName: moleculeData.variantName || legacyRevision?.variantName,
                appName: moleculeData.appName || legacyRevision?.appName,
                configName: moleculeData.configName,
                parameters: moleculeData.parameters,
                uri: moleculeData.uri || legacyRevision?.uri,
                createdAt: moleculeData.createdAt ?? legacyRevision?.createdAt,
                updatedAt: moleculeData.updatedAt ?? legacyRevision?.updatedAt,
                modifiedById: moleculeData.modifiedById ?? legacyRevision?.modifiedById,
                commitMessage: moleculeData.commitMessage ?? legacyRevision?.commitMessage,
            }
        }

        // Fallback to legacy atom
        return legacyRevision || null
    }),
)

/**
 * Check if a revision has unsaved local changes via molecule.
 *
 * Uses the molecule's isDirty atom as the single source of truth.
 * The molecule compares draft state against server data (bridge data).
 *
 * For local drafts:
 * - Initial state is stored in serverData when the draft is created
 * - Edits are stored in draft atom
 * - isDirty = true only when draft differs from serverData (i.e., user made changes)
 *
 * Usage:
 * ```typescript
 * const isDirty = useAtomValue(revisionIsDirtyAtomFamily(revisionId))
 * ```
 */
export const revisionIsDirtyAtomFamily = atomFamilyJotaiUtils((revisionId: string) =>
    atom((get) => {
        // Use molecule's isDirty as single source of truth
        // This compares draft against serverData (bridgeData)
        return get(ossAppRevisionMolecule.atoms.isDirty(revisionId))
    }),
)

/**
 * Get revision query state (loading, error) via molecule.
 *
 * Usage:
 * ```typescript
 * const { isPending, isError } = useAtomValue(revisionQueryStateAtomFamily(revisionId))
 * ```
 */
export const revisionQueryStateAtomFamily = atomFamilyJotaiUtils((revisionId: string) =>
    atom((get) => {
        return get(ossAppRevisionMolecule.atoms.query(revisionId))
    }),
)

// ============================================================================
// MOLECULE-BACKED PROMPTS (Single Source of Truth)
// ============================================================================

/**
 * Molecule-backed prompts atom family.
 *
 * This is the preferred way to access prompts in the playground.
 * It reads from the molecule's enhancedPrompts (which includes draft changes),
 * falling back to the legacy derivation if molecule data isn't available yet.
 *
 * Read: molecule.data.enhancedPrompts → legacy derivation (fallback)
 * Write: molecule.reducers.mutateEnhancedPrompts
 *
 * Usage:
 * ```typescript
 * // Read
 * const prompts = useAtomValue(moleculeBackedPromptsAtomFamily(revisionId))
 *
 * // Write (use Immer recipe)
 * const mutatePrompts = useSetAtom(moleculeBackedPromptsAtomFamily(revisionId))
 * mutatePrompts((draft) => {
 *   // ... modify draft
 * })
 * ```
 */
export const moleculeBackedPromptsAtomFamily = atomFamilyJotaiUtils((revisionId: string) =>
    atom(
        (get) => {
            // Try molecule first (has draft merged)
            const moleculeData = get(ossAppRevisionMolecule.atoms.data(revisionId))
            if (moleculeData?.enhancedPrompts && Array.isArray(moleculeData.enhancedPrompts)) {
                return moleculeData.enhancedPrompts
            }

            // Fallback: derive prompts from entity-level atom (schema + parameters)
            // This ensures prompts are available even outside playground context
            const entityPrompts = get(
                ossAppRevisionMolecule.selectors.enhancedPrompts?.(revisionId) ??
                    revisionEnhancedPromptsAtomFamily(revisionId),
            )
            if (entityPrompts && Array.isArray(entityPrompts) && entityPrompts.length > 0) {
                return entityPrompts
            }

            return []
        },
        (_get, set, update: ((draft: unknown[]) => void) | unknown[]) => {
            if (typeof update === "function") {
                // Immer recipe - use molecule's mutate reducer
                set(ossAppRevisionMolecule.reducers.mutateEnhancedPrompts, revisionId, update)
            } else {
                // Direct value - use molecule's set reducer
                set(ossAppRevisionMolecule.reducers.setEnhancedPrompts, revisionId, update)
            }
        },
    ),
)

/**
 * Molecule-backed custom properties atom family.
 *
 * Read: Uses entity-level enhancedCustomProperties (derived from schema + parameters)
 * Write: molecule.reducers.mutateEnhancedCustomProperties
 *
 * NOTE: Directly imports revisionEnhancedCustomPropertiesAtomFamily to ensure proper
 * reactivity when async schema query completes.
 */
export const moleculeBackedCustomPropertiesAtomFamily = atomFamily((revisionId: string) =>
    atom(
        (get) => {
            // First check if molecule has explicit enhancedCustomProperties (from draft)
            const moleculeData = get(ossAppRevisionMolecule.atoms.data(revisionId))

            if (
                moleculeData?.enhancedCustomProperties &&
                Object.keys(moleculeData.enhancedCustomProperties).length > 0
            ) {
                return moleculeData.enhancedCustomProperties as Record<string, unknown>
            }

            // Use entity-level derived custom properties directly from the atomFamily
            // This ensures proper subscription to async schema query updates
            const entityCustomProps = get(revisionEnhancedCustomPropertiesAtomFamily(revisionId))

            if (entityCustomProps && Object.keys(entityCustomProps).length > 0) {
                return entityCustomProps as Record<string, unknown>
            }

            return {}
        },
        (
            _get,
            set,
            update: ((draft: Record<string, unknown>) => void) | Record<string, unknown>,
        ) => {
            if (typeof update === "function") {
                set(
                    ossAppRevisionMolecule.reducers.mutateEnhancedCustomProperties,
                    revisionId,
                    update,
                )
            } else {
                set(ossAppRevisionMolecule.reducers.setEnhancedCustomProperties, revisionId, update)
            }
        },
    ),
)

// ============================================================================
// MUTATION REDIRECT
// ============================================================================

/**
 * Update a property by __id, routing to the molecule.
 *
 * This is the single entry point for property mutations in the playground.
 * It replaces the legacy updateVariantPropertyEnhancedMutationAtom.
 *
 * Usage:
 * ```typescript
 * const updateProperty = useSetAtom(moleculePropertyUpdateAtom)
 * updateProperty({ revisionId, propertyId, value })
 * ```
 */
export const moleculePropertyUpdateAtom = atom(
    null,
    (_get, set, params: {revisionId: string; propertyId: string; value: unknown}) => {
        const {revisionId, propertyId, value} = params

        set(ossAppRevisionMolecule.reducers.updateProperty, {
            revisionId,
            propertyId,
            value,
        })
    },
)

// ==========================================================================
// LOCAL DRAFT UTILITIES (Phase 4 - Local Draft Comparison)
// ==========================================================================

// Re-export entity-level draft atoms for single source of truth
export {localDraftIdsAtom, localDraftsListAtom, hasUnsavedLocalDraftsAtom}

/**
 * Check if a revision ID represents a local draft.
 * Local drafts use the format: `local-{sourceRevisionId}-{timestamp}`
 */
export function isLocalDraft(id: string): boolean {
    return isLocalDraftId(id)
}

/**
 * Extract the source revision ID from a local draft ID.
 * Returns null if the ID is not a local draft.
 */
export function getSourceRevisionId(localDraftId: string): string | null {
    return extractSourceIdFromDraft(localDraftId)
}

/**
 * Clone a committed revision (or local draft) as a new local draft using entity-level helpers.
 *
 * Ensures the source revision is present in the molecule cache before cloning.
 * If the source is itself a local draft, extracts the original source revision's variantId.
 *
 * @returns The local draft ID, or null if the source data is not ready yet
 */
export function cloneAsLocalDraft(sourceRevisionId: string): string | null {
    const store = getDefaultStore()

    // Ensure source data exists in molecule (fallback to revision list when needed)
    let sourceData = ossAppRevisionMolecule.get.data(sourceRevisionId)

    // If source is a local draft, get its original source revision ID for variantId lookup
    let variantIdSource = sourceRevisionId
    if (isLocalDraftId(sourceRevisionId)) {
        const originalSourceId =
            (sourceData as {_sourceRevisionId?: string} | null)?._sourceRevisionId ||
            extractSourceIdFromDraft(sourceRevisionId)
        if (originalSourceId) {
            variantIdSource = originalSourceId
        }
    }

    // If sourceData exists but is missing variantId, enrich it from revisionListAtom
    // This can happen when data comes from direct query which doesn't include variantId
    // or when cloning from a local draft
    if (!sourceData || !sourceData.variantId) {
        const revisions = store.get(revisionListAtom) || []
        // Look up variantId from the original source (not the local draft)
        const revisionFromList = revisions.find((r: any) => r.id === variantIdSource)

        if (revisionFromList) {
            const adapted = adaptRevisionToLegacyFormat(revisionFromList)
            if (adapted) {
                // Merge with existing data if present, otherwise use adapted data
                sourceData = sourceData ? {...sourceData, ...adapted} : adapted
                ossAppRevisionMolecule.set.serverData(sourceRevisionId, sourceData)
            }
        }
    }

    if (!sourceData) {
        return null
    }

    if (!sourceData.variantId) {
        return null
    }

    const localDraftId = createLocalDraftFromRevision(sourceRevisionId)

    if (!localDraftId) {
        return null
    }

    return localDraftId
}

/**
 * Discard a local draft, removing it from tracking and clearing molecule data.
 */
export function discardLocalDraft(localDraftId: string): void {
    discardEntityLocalDraft(localDraftId)
}

// ============================================================================
// UNIFIED DISCARD DRAFT ATOM
// Replaces scattered clearLocalPrompts/clearLocalCustomProps/clearLocalTransformed
// ============================================================================

/**
 * Unified atom for discarding all draft changes for a revision.
 *
 * This replaces the scattered clear atoms:
 * - clearLocalPromptsForRevisionAtomFamily
 * - clearLocalCustomPropsForRevisionAtomFamily
 * - clearLocalTransformedPromptsForRevisionAtomFamily
 *
 * Clears:
 * 1. Molecule draft state (enhanced prompts & custom properties)
 * 2. For local drafts: also removes from localDraftIdsAtom tracking and clears serverData
 *
 * Usage:
 * ```typescript
 * const discardDraft = useSetAtom(discardRevisionDraftAtom)
 * discardDraft(revisionId)
 * ```
 */
export const discardRevisionDraftAtom = atom(null, (_get, set, revisionId: string) => {
    if (!revisionId) return

    // 1. Use molecule's discard to clear enhanced prompts and custom properties drafts
    set(ossAppRevisionMolecule.reducers.discard, revisionId)

    // 2. For local drafts, also remove from tracking and clear serverData
    if (isLocalDraftId(revisionId)) {
        discardEntityLocalDraft(revisionId)
    }
})

/**
 * Imperative function to discard draft (for callbacks).
 *
 * Usage:
 * ```typescript
 * discardRevisionDraft(revisionId)
 * ```
 */
export function discardRevisionDraft(revisionId: string): void {
    if (!revisionId) return

    // 1. Use molecule's discard to clear enhanced prompts and custom properties drafts
    ossAppRevisionMolecule.set.discard(revisionId)

    // 2. For local drafts, also remove from tracking and clear serverData
    if (isLocalDraftId(revisionId)) {
        discardEntityLocalDraft(revisionId)
    }
}

// ============================================================================
// REVISION LABEL API
// Entity-level API for displaying revision labels consistently
// Uses shared utilities from @agenta/entities/shared for consistent formatting
// ============================================================================

// Re-export the type from shared for convenience
export type {RevisionLabelInfo}

/**
 * OSS-specific revision label info that includes variantName (specific to OSS).
 * Extends the shared RevisionLabelInfo with OSS-specific fields.
 */
export interface OssRevisionLabelInfo extends RevisionLabelInfo {
    /** The revision number (null for local drafts) - alias for version */
    revision: number | null
    /** The variant name (specific to OSS playground) */
    variantName: string | null
}

/**
 * Atom family that provides revision label information for a given revision ID.
 *
 * This is the single source of truth for revision display labels in the OSS playground.
 * It handles:
 * 1. Regular revisions - looks up from revisionListAtom or molecule data
 * 2. Local drafts - reads from molecule data (which stores _sourceRevision)
 *
 * Uses shared formatting utilities from @agenta/entities/shared for consistency.
 *
 * Components should use this instead of manually looking up revision info.
 *
 * Usage:
 * ```typescript
 * const labelInfo = useAtomValue(revisionLabelInfoAtomFamily(revisionId))
 * // labelInfo.label → "v3" or "Draft (based on v3)" or "Draft"
 * // labelInfo.revision → 3 or null
 * // labelInfo.isLocalDraft → true/false
 * ```
 */
export const revisionLabelInfoAtomFamily = atomFamilyJotaiUtils((revisionId: string) =>
    atom<OssRevisionLabelInfo>((get) => {
        // Handle local drafts using shared utility
        if (isLocalDraftId(revisionId)) {
            const moleculeData = get(ossAppRevisionMolecule.atoms.data(revisionId))
            const sourceRevision = (moleculeData as any)?._sourceRevision ?? null
            const variantName = moleculeData?.variantName ?? null

            return {
                version: null,
                revision: null,
                name: variantName,
                variantName,
                isLocalDraft: true,
                sourceVersion: sourceRevision,
                sourceRevision,
                label: formatLocalDraftLabel(sourceRevision),
                message: null,
                author: null,
            }
        }

        // Try molecule first (has more complete data including draft changes)
        const moleculeData = get(ossAppRevisionMolecule.atoms.data(revisionId))
        if (moleculeData?.revision != null) {
            return {
                version: moleculeData.revision,
                revision: moleculeData.revision,
                name: moleculeData.variantName ?? null,
                variantName: moleculeData.variantName ?? null,
                isLocalDraft: false,
                sourceVersion: null,
                sourceRevision: null,
                label: getVersionLabel(moleculeData.revision),
                message: null,
                author: null,
            }
        }

        // Fallback to revisionListAtom lookup
        const revisions = get(revisionListAtom) || []
        const revision = revisions.find((r: any) => r.id === revisionId)

        if (revision) {
            return {
                version: revision.revision,
                revision: revision.revision,
                name: revision.variantName ?? null,
                variantName: revision.variantName ?? null,
                isLocalDraft: false,
                sourceVersion: null,
                sourceRevision: null,
                label: getVersionLabel(revision.revision),
                message: null,
                author: null,
            }
        }

        // Revision not found - return safe defaults
        return {
            version: null,
            revision: null,
            name: null,
            variantName: null,
            isLocalDraft: false,
            sourceVersion: null,
            sourceRevision: null,
            label: "Unknown",
            message: null,
            author: null,
        }
    }),
)

/**
 * Imperative function to get revision label info (for callbacks).
 *
 * Usage:
 * ```typescript
 * const labelInfo = getOssRevisionLabelInfo(revisionId)
 * console.log(labelInfo.label) // "v3" or "Draft"
 * ```
 */
export function getOssRevisionLabelInfo(revisionId: string): OssRevisionLabelInfo {
    const store = getDefaultStore()
    return store.get(revisionLabelInfoAtomFamily(revisionId))
}

/**
 * @deprecated Use `getOssRevisionLabelInfo` instead for clarity,
 * or import `getRevisionLabelInfo` from `@agenta/entities/shared` for the generic utility.
 */
export const getRevisionLabelInfo = getOssRevisionLabelInfo

// ============================================================================
// PLAYGROUND VARIANT META MAP
// Aggregates deployment + draft metadata for UI rendering (replaces optionsSelectors.ts)
// ============================================================================

/**
 * Metadata for a variant (parent group in selection tree).
 */
export interface PlaygroundVariantMeta {
    id: string
    name: string
    deployedIn: {name: string; [key: string]: unknown}[]
    isLocalDraftGroup: boolean
}

/**
 * Metadata for a revision (child item in selection tree).
 */
export interface PlaygroundRevisionMeta {
    id: string
    revision: number
    variantId: string
    variantName: string
    isLocalDraft: boolean
    isDirty: boolean
    isLatestRevision: boolean
    deployedIn: {name: string; [key: string]: unknown}[]
    sourceRevisionId?: string
    variant?: unknown
}

/**
 * Combined meta map for playground variant/revision UI rendering.
 */
export interface PlaygroundVariantMetaMap {
    variants: Map<string, PlaygroundVariantMeta>
    revisions: Map<string, PlaygroundRevisionMeta>
}

/**
 * Atom that provides aggregated metadata for playground variant/revision UI.
 *
 * This replaces `variantOptionsAtomFamily` from optionsSelectors.ts by:
 * 1. Using revisionListAtom (molecule-backed) for structure
 * 2. Aggregating deployment environments via revisionDeploymentAtomFamily
 * 3. Including local draft info (isLocalDraft, isDirty)
 *
 * Components use this for custom rendering in EntityPicker (deployment badges, etc.)
 *
 * Usage:
 * ```typescript
 * const metaMap = useAtomValue(playgroundVariantMetaMapAtom)
 * const variantMeta = metaMap.variants.get(variantId)
 * const revisionMeta = metaMap.revisions.get(revisionId)
 * ```
 */
export const playgroundVariantMetaMapAtom = atom<PlaygroundVariantMetaMap>((get) => {
    const variants = new Map<string, PlaygroundVariantMeta>()
    const revisions = new Map<string, PlaygroundRevisionMeta>()

    // Get all revisions from the molecule-backed list
    const allRevisions = get(revisionListAtom) || []

    // Group revisions by variantId
    const revisionsByVariant = new Map<string, typeof allRevisions>()
    for (const rev of allRevisions) {
        const variantId = (rev as any).variantId
        if (!variantId) continue

        if (!revisionsByVariant.has(variantId)) {
            revisionsByVariant.set(variantId, [])
        }
        revisionsByVariant.get(variantId)!.push(rev)
    }

    // Build variant metadata with aggregated deployments
    for (const [variantId, variantRevisions] of revisionsByVariant) {
        const firstRev = variantRevisions[0] as any

        // Aggregate deployments from all revisions in this variant
        const allDeployments: {name: string; [key: string]: unknown}[] = []
        const seenEnvNames = new Set<string>()

        for (const rev of variantRevisions) {
            const revId = (rev as any).id
            const envs = get(revisionDeploymentAtomFamily(revId)) || []
            for (const env of envs as {name: string}[]) {
                if (!seenEnvNames.has(env.name)) {
                    seenEnvNames.add(env.name)
                    allDeployments.push(env)
                }
            }
        }

        variants.set(variantId, {
            id: variantId,
            name: firstRev?.variantName || "Unnamed",
            deployedIn: allDeployments,
            isLocalDraftGroup: false,
        })
    }

    // Build revision metadata
    for (const rev of allRevisions) {
        const r = rev as any
        const revId = r.id
        const isLocal = isLocalDraftId(revId)

        // Get deployment info for this specific revision
        const envs = get(revisionDeploymentAtomFamily(revId)) || []

        // Get dirty state
        const isDirty = isLocal ? true : get(ossAppRevisionMolecule.atoms.isDirty(revId))

        revisions.set(revId, {
            id: revId,
            revision: r.revision ?? 0,
            variantId: r.variantId ?? "",
            variantName: r.variantName ?? "",
            isLocalDraft: isLocal,
            isDirty,
            isLatestRevision: r.isLatestRevision ?? false,
            deployedIn: envs as {name: string}[],
            sourceRevisionId: isLocal ? (getSourceRevisionId(revId) ?? undefined) : undefined,
            variant: rev,
        })
    }

    // Add local drafts group if any exist
    const localDrafts = get(localDraftsListAtom)
    if (localDrafts.length > 0) {
        variants.set("__local_drafts__", {
            id: "__local_drafts__",
            name: "Local Drafts",
            deployedIn: [],
            isLocalDraftGroup: true,
        })

        // Add local draft revisions
        for (const draft of localDrafts) {
            const sourceId = draft.sourceRevisionId
            const sourceData = draft.data

            revisions.set(draft.id, {
                id: draft.id,
                revision: sourceData.revision ?? 0,
                variantId: "__local_drafts__",
                variantName: sourceData.variantName ?? "",
                isLocalDraft: true,
                isDirty: draft.isDirty,
                isLatestRevision: false,
                deployedIn: [],
                sourceRevisionId: sourceId ?? undefined,
                variant: {
                    ...sourceData,
                    id: draft.id,
                    isLocalDraft: true,
                },
            })
        }
    }

    return {variants, revisions}
})
