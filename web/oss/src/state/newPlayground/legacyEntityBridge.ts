/**
 * Legacy Entity Bridge
 *
 * Bridges the existing OSS playground state with the legacyAppRevision entity
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

import {
    legacyAppRevisionMolecule,
    createLocalDraftFromRevision,
    discardLocalDraft as discardEntityLocalDraft,
    localDraftIdsAtom,
    localDraftsListAtom,
    hasUnsavedLocalDraftsAtom,
    revisionEnhancedCustomPropertiesAtomFamily,
    revisionEnhancedPromptsAtomFamily,
    variantsListWithDraftsAtomFamily,
    revisionsListWithDraftsAtomFamily,
    setCurrentAppIdAtom,
} from "@agenta/entities/legacyAppRevision"
import {
    isLocalDraftId,
    getVersionLabel,
    formatLocalDraftLabel,
    type RevisionLabelInfo,
} from "@agenta/entities/shared"
import {atom, getDefaultStore} from "jotai"
import {atomFamily as atomFamilyJotaiUtils} from "jotai/utils"
import {atomFamily} from "jotai-family"

import {playgroundRevisionDeploymentAtomFamily} from "@/oss/components/Playground/state/atoms/playgroundAppAtoms"
import {playgroundRevisionListAtom} from "@/oss/components/Playground/state/atoms/variants"
import {selectedAppIdAtom} from "@/oss/state/app/selectors/app"

// ============================================================================
// APP ID REGISTRATION FOR LOCAL DRAFTS
// Wire up app scoping for local draft storage
// ============================================================================

// Register the app ID atom with the entities package to enable app-scoped local drafts
// This must be called before any local draft operations
setCurrentAppIdAtom(selectedAppIdAtom as ReturnType<typeof atom<string | null>>)

// ============================================================================
// MOLECULE ACCESS HELPERS
// ============================================================================

/**
 * Get the legacyAppRevision molecule.
 * This is the recommended way to access the molecule in components.
 */
export {legacyAppRevisionMolecule}

/**
 * Re-export commonly used molecule APIs for convenience.
 */
export const ossRevision = {
    /**
     * Atoms for reactive subscriptions (use with useAtomValue)
     */
    atoms: legacyAppRevisionMolecule.atoms,

    /**
     * Selectors for derived state (use with useAtomValue)
     */
    selectors: legacyAppRevisionMolecule.selectors,

    /**
     * Reducers for mutations (use with useSetAtom)
     */
    reducers: legacyAppRevisionMolecule.reducers,

    /**
     * Imperative getters (for callbacks)
     */
    get: legacyAppRevisionMolecule.get,

    /**
     * Imperative setters (for callbacks)
     */
    set: legacyAppRevisionMolecule.set,
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
     * Get molecule data for a revision
     */
    getMoleculeData: (revisionId: string) => {
        return legacyAppRevisionMolecule.get.data(revisionId)
    },

    /**
     * Get molecule server data for a revision
     */
    getServerData: (revisionId: string) => {
        return legacyAppRevisionMolecule.get.serverData(revisionId)
    },

    /**
     * Get molecule draft for a revision
     */
    getDraft: (revisionId: string) => {
        return legacyAppRevisionMolecule.get.draft(revisionId)
    },

    /**
     * Check if revision has unsaved changes
     */
    isDirty: (revisionId: string) => {
        return legacyAppRevisionMolecule.get.isDirty(revisionId)
    },

    /**
     * Log full molecule state for a revision
     */
    inspect: (revisionId: string) => {
        const data = legacyAppRevisionMolecule.get.data(revisionId)
        const serverData = legacyAppRevisionMolecule.get.serverData(revisionId)
        const draft = legacyAppRevisionMolecule.get.draft(revisionId)
        const isDirty = legacyAppRevisionMolecule.get.isDirty(revisionId)

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
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    ;(window as any).__legacyEntityBridge = debugBridge
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
 * 2. Falls back to legacy playgroundRevisionListAtom lookup
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
        const moleculeData = get(legacyAppRevisionMolecule.atoms.data(revisionId))

        // Also get legacy revision data for fallback fields (e.g., variantName)
        const revisions = get(playgroundRevisionListAtom) || []
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
        return get(legacyAppRevisionMolecule.atoms.isDirty(revisionId))
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
        return get(legacyAppRevisionMolecule.atoms.query(revisionId))
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
            const moleculeData = get(legacyAppRevisionMolecule.atoms.data(revisionId))

            if (
                moleculeData?.enhancedPrompts &&
                Array.isArray(moleculeData.enhancedPrompts) &&
                moleculeData.enhancedPrompts.length > 0
            ) {
                return moleculeData.enhancedPrompts
            }

            // Fallback: derive prompts from entity-level atom (schema + parameters)
            // This ensures prompts are available even outside playground context
            const entityPrompts = get(
                legacyAppRevisionMolecule.selectors.enhancedPrompts?.(revisionId) ??
                    revisionEnhancedPromptsAtomFamily(revisionId),
            )

            if (entityPrompts && Array.isArray(entityPrompts) && entityPrompts.length > 0) {
                return entityPrompts
            }

            return []
        },
        (get, set, update: ((draft: unknown[]) => void) | unknown[]) => {
            // Check if the molecule's base already has enhancedPrompts.
            // mutateEnhancedPrompts operates on base.enhancedPrompts — if that's
            // empty the mutation silently does nothing. When base lacks prompts
            // (common on initial load / after reload), we pre-apply the mutation
            // to entity-derived prompts and write the result in a single step
            // via setEnhancedPrompts, avoiding the seed-then-mutate race.
            const moleculeData = get(legacyAppRevisionMolecule.atoms.data(revisionId))
            const draft = get(legacyAppRevisionMolecule.atoms.draft(revisionId))
            const serverData = get(legacyAppRevisionMolecule.atoms.serverData(revisionId))
            const base = draft || serverData
            const baseHasPrompts =
                base?.enhancedPrompts &&
                Array.isArray(base.enhancedPrompts) &&
                base.enhancedPrompts.length > 0

            if (typeof update !== "function") {
                // Direct value — always safe
                set(legacyAppRevisionMolecule.reducers.setEnhancedPrompts, revisionId, update)
                return
            }

            if (baseHasPrompts) {
                // Normal path — base has prompts, mutation reducer will work
                set(legacyAppRevisionMolecule.reducers.mutateEnhancedPrompts, revisionId, update)
                return
            }

            // Base lacks enhancedPrompts — derive from entity, seed original, then mutate.
            // We must seed the ORIGINAL prompts first so that serverData gets the
            // unmodified baseline. Then mutateEnhancedPrompts creates a proper draft
            // with the user's change, allowing isDirty to detect the difference.
            const entityPrompts = get(revisionEnhancedPromptsAtomFamily(revisionId))
            const sourcePrompts =
                entityPrompts && Array.isArray(entityPrompts) && entityPrompts.length > 0
                    ? (entityPrompts as unknown[])
                    : (moleculeData?.enhancedPrompts as unknown[]) || []

            if (sourcePrompts.length === 0) {
                // Nothing to mutate — no prompts available anywhere
                return
            }

            // Step 1: Seed the original (unmodified) prompts to serverData
            set(legacyAppRevisionMolecule.reducers.setEnhancedPrompts, revisionId, sourcePrompts)

            // Step 2: Now base has prompts — mutate to create a proper draft
            set(legacyAppRevisionMolecule.reducers.mutateEnhancedPrompts, revisionId, update)
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
            const moleculeData = get(legacyAppRevisionMolecule.atoms.data(revisionId))

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
            get,
            set,
            update: ((draft: Record<string, unknown>) => void) | Record<string, unknown>,
        ) => {
            if (typeof update !== "function") {
                set(
                    legacyAppRevisionMolecule.reducers.setEnhancedCustomProperties,
                    revisionId,
                    update,
                )
                return
            }

            // Check if mutation base has custom properties
            const draft = get(legacyAppRevisionMolecule.atoms.draft(revisionId))
            const serverData = get(legacyAppRevisionMolecule.atoms.serverData(revisionId))
            const base = draft || serverData
            const baseHasProps =
                base?.enhancedCustomProperties &&
                Object.keys(base.enhancedCustomProperties).length > 0

            if (baseHasProps) {
                set(
                    legacyAppRevisionMolecule.reducers.mutateEnhancedCustomProperties,
                    revisionId,
                    update,
                )
                return
            }

            // Base lacks custom properties — seed original, then mutate
            const entityCustomProps = get(revisionEnhancedCustomPropertiesAtomFamily(revisionId))
            const sourceProps =
                entityCustomProps && Object.keys(entityCustomProps).length > 0
                    ? (entityCustomProps as Record<string, unknown>)
                    : (base?.enhancedCustomProperties as Record<string, unknown>) || {}

            if (Object.keys(sourceProps).length === 0) return

            // Step 1: Seed original (unmodified) custom properties to serverData
            set(
                legacyAppRevisionMolecule.reducers.setEnhancedCustomProperties,
                revisionId,
                sourceProps,
            )

            // Step 2: Now base has custom properties — mutate to create a proper draft
            set(
                legacyAppRevisionMolecule.reducers.mutateEnhancedCustomProperties,
                revisionId,
                update,
            )
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
    (get, set, params: {revisionId: string; propertyId: string; value: unknown}) => {
        const {revisionId, propertyId, value} = params

        // updatePropertyAtom searches base.enhancedPrompts / base.enhancedCustomProperties
        // to find the property by __id. If base lacks enhanced data (common on initial load
        // before any user edit), seed them first. We seed by writing to serverData via
        // setEnhancedPrompts/setEnhancedCustomProperties — these atoms handle initial seeding
        // by writing to legacyAppRevisionServerDataAtomFamily (not creating a draft).
        //
        // IMPORTANT: We must seed BEFORE calling updateProperty, and the seeding must be
        // visible to updateProperty's get(). We do this by using the molecule's set reducers
        // which write to the actual store atoms within the same transaction.
        const currentDraft = get(legacyAppRevisionMolecule.atoms.draft(revisionId))
        const serverData = get(legacyAppRevisionMolecule.atoms.serverData(revisionId))
        const base = currentDraft || serverData

        if (base) {
            const needsPromptSeed = !base.enhancedPrompts || base.enhancedPrompts.length === 0
            const needsCustomPropsSeed =
                !base.enhancedCustomProperties ||
                Object.keys(base.enhancedCustomProperties).length === 0

            if (needsPromptSeed) {
                const entityPrompts = get(revisionEnhancedPromptsAtomFamily(revisionId))
                if (entityPrompts && entityPrompts.length > 0) {
                    // setEnhancedPrompts detects initial seeding (no draft, no existing prompts)
                    // and writes to serverData atom, making prompts available to updateProperty
                    set(
                        legacyAppRevisionMolecule.reducers.setEnhancedPrompts,
                        revisionId,
                        entityPrompts as unknown[],
                    )
                }
            }

            if (needsCustomPropsSeed) {
                const entityCustomProps = get(
                    revisionEnhancedCustomPropertiesAtomFamily(revisionId),
                )
                if (entityCustomProps && Object.keys(entityCustomProps).length > 0) {
                    set(
                        legacyAppRevisionMolecule.reducers.setEnhancedCustomProperties,
                        revisionId,
                        entityCustomProps as Record<string, unknown>,
                    )
                }
            }
        }

        set(legacyAppRevisionMolecule.reducers.updateProperty, {
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
 * Extract the source revision ID from a local draft.
 * Reads from molecule data where the source is actually stored.
 * Returns null if the ID is not a local draft.
 */
export function getSourceRevisionId(localDraftId: string): string | null {
    if (!isLocalDraftId(localDraftId)) return null

    // Read from molecule data where source is actually stored
    // The _sourceRevisionId field is set when creating the draft
    const data = legacyAppRevisionMolecule.get.data(localDraftId)
    return (data as any)?._sourceRevisionId ?? null
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
    let sourceData = legacyAppRevisionMolecule.get.data(sourceRevisionId)

    // If source is a local draft, get the original source revision ID for lookups
    // Use _sourceRevisionId from molecule data (not ID parsing which doesn't work)
    let variantIdSource = sourceRevisionId
    if (isLocalDraftId(sourceRevisionId) && sourceData) {
        const originalSourceId = (sourceData as any)?._sourceRevisionId
        if (originalSourceId) {
            variantIdSource = originalSourceId
        }
    }

    // If sourceData is missing or lacks variantId/baseId, enrich from entity atoms.
    // This can happen when:
    // - Data comes from a direct query which doesn't include variantId
    // - Cloning from a local draft
    // - Molecule hasn't been populated yet for this revision
    if (!sourceData || !sourceData.variantId || !(sourceData as any).baseId) {
        // Shallow-clone so we can safely add/modify properties
        // (molecule data may be frozen by Jotai)
        if (sourceData) {
            sourceData = {...sourceData}
        }

        const appId = store.get(selectedAppIdAtom)
        if (appId) {
            const variantsList = store.get(variantsListWithDraftsAtomFamily(appId))?.data ?? []

            // If sourceData is entirely missing, try to build it from the revision list
            if (!sourceData) {
                for (const variant of variantsList) {
                    if (!variant?.id) continue
                    const revQuery = store.get(revisionsListWithDraftsAtomFamily(variant.id))
                    const revisions = revQuery?.data ?? []
                    const match = revisions.find((r: any) => r.id === variantIdSource)
                    if (match) {
                        sourceData = {
                            id: sourceRevisionId,
                            variantId: variant.id,
                            appId,
                            revision: (match as any).revision,
                            variantName: (variant as any).name || (variant as any).baseName,
                            parameters: (match as any).parameters ?? {},
                            uri: (match as any).uri,
                            isLatestRevision: (match as any).isLatestRevision ?? false,
                        } as any
                        break
                    }
                }
            }

            // If variantId is missing, find it by looking up which variant owns this revision
            if (sourceData && !sourceData.variantId) {
                for (const variant of variantsList) {
                    if (!variant?.id) continue
                    const revQuery = store.get(revisionsListWithDraftsAtomFamily(variant.id))
                    const revisions = revQuery?.data ?? []
                    const match = revisions.find((r: any) => r.id === variantIdSource)
                    if (match) {
                        sourceData = {...sourceData, variantId: variant.id}
                        break
                    }
                }
            }

            // Ensure baseId is available from the variants list
            if (sourceData?.variantId && !(sourceData as any).baseId) {
                const parentVariant = variantsList.find((v: any) => v.id === sourceData?.variantId)
                if (parentVariant?.baseId) {
                    ;(sourceData as any).baseId = parentVariant.baseId
                }
            }

            if (sourceData?.variantId) {
                legacyAppRevisionMolecule.set.serverData(sourceRevisionId, sourceData)
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
    set(legacyAppRevisionMolecule.reducers.discard, revisionId)

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
    legacyAppRevisionMolecule.set.discard(revisionId)

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
 * 1. Regular revisions - looks up from playgroundRevisionListAtom or molecule data
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
            const moleculeData = get(legacyAppRevisionMolecule.atoms.data(revisionId))
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
        const moleculeData = get(legacyAppRevisionMolecule.atoms.data(revisionId))
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

        // Fallback to playgroundRevisionListAtom lookup
        const revisions = get(playgroundRevisionListAtom) || []
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
 * 1. Using playgroundRevisionListAtom (molecule-backed) for structure
 * 2. Aggregating deployment environments via playgroundRevisionDeploymentAtomFamily
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
    const allRevisions = get(playgroundRevisionListAtom) || []

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
            const envs = get(playgroundRevisionDeploymentAtomFamily(revId)) || []
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
        const envs = get(playgroundRevisionDeploymentAtomFamily(revId)) || []

        // Get dirty state
        const isDirty = isLocal ? true : get(legacyAppRevisionMolecule.atoms.isDirty(revId))

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
