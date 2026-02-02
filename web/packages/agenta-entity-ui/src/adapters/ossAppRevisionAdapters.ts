/**
 * OssAppRevision Modal Adapters
 *
 * Registers ossAppRevision (variant) entity adapter for the unified modal system.
 * These adapters enable EntityDeleteModal and EntityCommitModal to work with
 * OSS app revision entities (variants in the playground).
 *
 * Uses the unified entity API:
 * - `ossAppRevisionMolecule.atoms.data(id)` - data with draft merged
 * - `ossAppRevisionMolecule.atoms.serverData(id)` - raw server data
 * - `ossAppRevisionMolecule.atoms.isDirty(id)` - check for unsaved changes
 * - `ossAppRevisionMolecule.actions.commit` - commit with polling workaround
 *
 * ## Commit Flow
 *
 * The commit operation uses the molecule's commit action which:
 * 1. Calls the legacy API (PUT /variants/{variantId}/parameters)
 * 2. Invokes registered callbacks (query invalidation)
 * 3. Polls for new revision to appear
 * 4. Invokes registered callbacks (playground orchestration)
 * 5. Returns {newRevisionId, newRevision}
 *
 * Playground-specific orchestration (chat history, selection) is handled
 * via callbacks registered with `registerCommitCallbacks()`.
 */

import {
    ossAppRevisionMolecule,
    type OssAppRevisionData,
    type CommitRevisionParams,
} from "@agenta/entities/ossAppRevision"
import {isLocalDraftId, getVersionLabel, formatLocalDraftLabel} from "@agenta/entities/shared"
import {atom} from "jotai"

import {
    createAndRegisterEntityAdapter,
    type CommitContext,
    type CommitParams,
    type EntityModalAdapter,
} from "../modals"

// ============================================================================
// DATA ATOM
// ============================================================================

/**
 * OSS app revision data atom factory for modal adapter.
 * Reads from the molecule's data atom (includes draft changes).
 */
const ossAppRevisionDataAtom = (id: string) =>
    atom((get) => {
        return get(ossAppRevisionMolecule.atoms.data(id))
    })

// ============================================================================
// DIFF DATA HELPERS
// ============================================================================

/**
 * Extract configuration data for diff display.
 * For OSS variants, we diff the parameters/enhancedPrompts.
 */
function extractDiffableData(data: OssAppRevisionData | null): Record<string, unknown> {
    if (!data) return {}

    const result: Record<string, unknown> = {}

    // Include enhanced prompts if available (these are the UI-visible prompts)
    if (data.enhancedPrompts && Array.isArray(data.enhancedPrompts)) {
        result.prompts = data.enhancedPrompts
    }

    // Include enhanced custom properties if available
    if (data.enhancedCustomProperties) {
        result.customProperties = data.enhancedCustomProperties
    }

    // Fallback to raw parameters if no enhanced data
    if (!result.prompts && !result.customProperties && data.parameters) {
        result.parameters = data.parameters
    }

    return result
}

/**
 * Count changes between server and draft data.
 * Returns a simple summary of what changed.
 */
function countChanges(
    serverData: OssAppRevisionData | null,
    draftData: OssAppRevisionData | null,
): {promptChanges: number; propertyChanges: number; description?: string} {
    if (!serverData || !draftData) {
        return {promptChanges: 0, propertyChanges: 0}
    }

    let promptChanges = 0
    let propertyChanges = 0

    // Compare enhanced prompts
    const serverPrompts = serverData.enhancedPrompts || []
    const draftPrompts = draftData.enhancedPrompts || []

    if (JSON.stringify(serverPrompts) !== JSON.stringify(draftPrompts)) {
        promptChanges = 1
    }

    // Compare enhanced custom properties
    const serverProps = serverData.enhancedCustomProperties || {}
    const draftProps = draftData.enhancedCustomProperties || {}

    if (JSON.stringify(serverProps) !== JSON.stringify(draftProps)) {
        propertyChanges = 1
    }

    // If no enhanced data, compare raw parameters
    if (promptChanges === 0 && propertyChanges === 0) {
        const serverParams = serverData.parameters || {}
        const draftParams = draftData.parameters || {}

        if (JSON.stringify(serverParams) !== JSON.stringify(draftParams)) {
            propertyChanges = 1
        }
    }

    return {promptChanges, propertyChanges}
}

// ============================================================================
// COMMIT CONTEXT ATOM
// ============================================================================

/**
 * Commit context atom factory for variant.
 * Provides version info, changes summary, and diff data for the commit modal.
 *
 * Note: This does NOT include the actual commit atom because OSS variant commits
 * require complex orchestration that should stay in the playground layer.
 */
const variantCommitContextAtom = (revisionId: string, _metadata?: Record<string, unknown>) =>
    atom((get): CommitContext | null => {
        const isLocalDraft = isLocalDraftId(revisionId)

        // Get current draft data (merged server + local changes)
        const draftData = get(ossAppRevisionMolecule.atoms.data(revisionId))
        if (!draftData) return null

        // Get server data for comparison
        const serverData = get(ossAppRevisionMolecule.atoms.serverData(revisionId))

        // Determine version info
        let currentVersion: number
        let targetVersion: number

        if (isLocalDraft) {
            // Local draft: get source version from metadata
            const sourceRevision = (draftData as Record<string, unknown>)._sourceRevision as
                | number
                | null
            currentVersion = sourceRevision ?? 0
            targetVersion = currentVersion + 1
        } else {
            // Regular revision: use current revision number
            currentVersion = draftData.revision ?? 0
            targetVersion = currentVersion + 1
        }

        // Count changes
        const {promptChanges, propertyChanges} = countChanges(serverData, draftData)
        const hasChanges = promptChanges > 0 || propertyChanges > 0 || isLocalDraft

        // Build changes description
        const descriptions: string[] = []
        if (promptChanges > 0) descriptions.push("Prompt configuration modified")
        if (propertyChanges > 0) descriptions.push("Custom properties modified")
        if (isLocalDraft && descriptions.length === 0) {
            descriptions.push("New draft variant")
        }

        // Build diff data
        const originalStructure = extractDiffableData(serverData)
        const modifiedStructure = extractDiffableData(draftData)

        const original = JSON.stringify(originalStructure, null, 2)
        const modified = JSON.stringify(modifiedStructure, null, 2)

        // Only include diff data if there are actual changes
        const hasDiff = original !== modified

        return {
            versionInfo: {
                currentVersion,
                targetVersion,
                latestVersion: currentVersion, // In OSS, we don't track latest across all variants
            },
            changesSummary: hasChanges
                ? {
                      modifiedCount: promptChanges + propertyChanges,
                      description: descriptions.join(", "),
                  }
                : undefined,
            diffData: hasDiff
                ? {
                      original,
                      modified,
                      language: "json",
                  }
                : undefined,
        }
    })

// ============================================================================
// COMMIT ATOM
// ============================================================================

/**
 * Commit atom for variant.
 *
 * Uses the molecule's commit action which encapsulates the legacy API workaround:
 * 1. Calls PUT /variants/{variantId}/parameters
 * 2. Polls for new revision to appear
 * 3. Returns {newRevisionId}
 *
 * Playground-specific orchestration (query invalidation, chat history, selection)
 * should be registered via `registerCommitCallbacks()` from the playground layer.
 *
 * @example
 * ```typescript
 * // In playground initialization
 * import { registerCommitCallbacks } from '@agenta/entities/ossAppRevision'
 *
 * registerCommitCallbacks({
 *   onQueryInvalidate: async () => {
 *     await set(invalidatePlaygroundQueriesAtom)
 *   },
 *   onNewRevision: async (result, params) => {
 *     // Update selected variants, duplicate chat history
 *   },
 * })
 * ```
 */
const variantCommitAtom = atom(null, async (get, set, params: CommitParams): Promise<void> => {
    const {id, message} = params

    // Get entity data to extract variantId and parameters
    const data = get(ossAppRevisionMolecule.atoms.data(id))
    if (!data) {
        throw new Error(`Entity not found: ${id}`)
    }

    // Extract variantId - required for the API call
    // The variantId should be present in data via useSetRevisionVariantContext hook
    const variantId = data.variantId
    if (!variantId) {
        throw new Error(`No variantId found for entity: ${id}`)
    }

    // Build parameters from enhanced data
    // The molecule stores enhanced prompts/custom props, but API expects ag_config format
    const parameters: Record<string, unknown> = {}

    if (data.parameters) {
        // Start with raw parameters
        Object.assign(parameters, data.parameters)
    }

    // The commit action handles the rest (API call, polling, callbacks)
    const commitParams: CommitRevisionParams = {
        revisionId: id,
        variantId,
        parameters,
        commitMessage: message,
    }

    const result = await set(ossAppRevisionMolecule.actions.commit, commitParams)

    if (!result.success) {
        throw result.error
    }

    // Return type is void - the new revision ID is handled via callbacks
})

// ============================================================================
// DELETE ATOM
// ============================================================================

/**
 * Placeholder delete atom for variants.
 * Actual deletion is handled by the playground's deleteVariantMutationAtom.
 *
 * Note: This adapter is primarily for commit modal support, not deletion.
 * Variant deletion requires complex orchestration (selection updates, query
 * invalidation) that should stay in the playground layer.
 */
const variantDeleteAtom = atom(null, async (_get, _set, _ids: string[]): Promise<void> => {
    // Variant deletion is handled by the playground layer
    // This is a placeholder to satisfy the adapter interface
    console.warn(
        "[ossAppRevisionAdapter] Delete called but not implemented. " +
            "Use playground deleteVariantMutationAtom instead.",
    )
})

// ============================================================================
// ADAPTERS
// ============================================================================

/**
 * Variant (OSS app revision) modal adapter.
 *
 * This adapter enables the EntityCommitModal to work with OSS playground variants.
 *
 * ## Commit Flow
 *
 * The adapter uses `ossAppRevisionMolecule.actions.commit` which:
 * 1. Calls legacy API (PUT /variants/{variantId}/parameters)
 * 2. Invokes `onQueryInvalidate` callback (for playground query invalidation)
 * 3. Polls for new revision to appear
 * 4. Invokes `onNewRevision` callback (for selection/chat history updates)
 * 5. Clears draft state
 *
 * ## Playground Integration
 *
 * Register callbacks in your playground initialization:
 *
 * ```typescript
 * import { registerCommitCallbacks } from '@agenta/entities/ossAppRevision'
 *
 * registerCommitCallbacks({
 *   onQueryInvalidate: async () => {
 *     await set(invalidatePlaygroundQueriesAtom)
 *   },
 *   onNewRevision: async (result, params) => {
 *     // Update selected variants
 *     // Duplicate chat history to new revision
 *   },
 * })
 * ```
 *
 * ## Usage
 *
 * ```tsx
 * import { useEntityCommit, EntityCommitModal } from '@agenta/entity-ui'
 *
 * const { commitEntity } = useEntityCommit()
 *
 * <Button onClick={() => commitEntity('variant', revisionId, variantName)}>
 *   Commit
 * </Button>
 *
 * <EntityCommitModal />
 * ```
 */
export const variantModalAdapter: EntityModalAdapter<OssAppRevisionData> =
    createAndRegisterEntityAdapter({
        type: "variant",
        getDisplayName: (entity) => {
            if (!entity) return "Untitled Variant"

            // Check if it's a local draft
            if (entity.id && isLocalDraftId(entity.id)) {
                const sourceRevision = (entity as Record<string, unknown>)._sourceRevision as
                    | number
                    | null
                return formatLocalDraftLabel(sourceRevision)
            }

            // Regular revision: show variant name and version
            const name = entity.variantName || "Variant"
            const version = entity.revision ?? 0
            return `${name} ${getVersionLabel(version)}`
        },
        getDisplayLabel: (count) => (count === 1 ? "Variant" : "Variants"),
        deleteAtom: variantDeleteAtom,
        dataAtom: ossAppRevisionDataAtom,
        canDelete: () => true, // Actual check should happen in playground layer
        getDeleteWarning: () => null,
        // Commit context for display in EntityCommitModal
        commitContextAtom: variantCommitContextAtom,
        canCommit: (entity) => {
            // Check if entity has unsaved changes
            if (!entity) return false
            // For display purposes - actual check uses molecule.isDirty
            return true
        },
        // Commit atom using molecule's commit action
        commitAtom: variantCommitAtom,
    })

// ============================================================================
// AUTO-REGISTRATION
// ============================================================================

/**
 * Adapters are registered when this module is imported.
 * The createAndRegisterEntityAdapter function handles registration.
 *
 * To ensure adapters are registered, import this module at app startup:
 *
 * @example
 * ```typescript
 * // In OSS app initialization
 * import '@agenta/entity-ui/adapters/ossAppRevisionAdapters'
 * ```
 */
