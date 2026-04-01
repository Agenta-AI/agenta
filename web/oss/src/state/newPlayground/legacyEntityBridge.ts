/**
 * Entity Bridge — Side Effects Only
 *
 * Registers playground-specific orchestration with the entity layer:
 * 1. RunnableBridge registration with playground package
 * 2. Selection change callback (URL sync, drawer state)
 *
 * This module has no exports — import it for side effects only:
 * ```typescript
 * import "@/oss/state/newPlayground/legacyEntityBridge"
 * ```
 */
export const moleculeBackedVariantAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        // Use molecule as the single source of truth (has draft merged)
        const moleculeData = get(legacyAppRevisionMolecule.atoms.data(revisionId))

        if (moleculeData) {
            // Transform molecule data back to legacy format for compatibility
            return {
                id: moleculeData.id,
                variantId: moleculeData.variantId,
                appId: moleculeData.appId,
                revision: moleculeData.revision,
                isLatestRevision: moleculeData.isLatestRevision,
                variantName: moleculeData.variantName,
                appName: moleculeData.appName,
                configName: moleculeData.configName,
                parameters: moleculeData.parameters,
                uri: moleculeData.uri,
                createdAt: moleculeData.createdAt,
                updatedAt: moleculeData.updatedAt,
                modifiedById: moleculeData.modifiedById,
                modifiedBy: moleculeData.modifiedBy,
                commitMessage: moleculeData.commitMessage,
            }
        }

        return null
    }),
)

/**
 * Check if a revision has unsaved local changes via molecule.
 *
 * Uses the molecule's isDirty atom as the single source of truth.
 * The molecule compares draft state against server data (bridge data).
 *
 * Compatibility note:
 * - `moleculeBackedPromptsAtomFamily` is still exported for older consumers.
 */

import {legacyAppRevisionMolecule} from "@agenta/entities/legacyAppRevision"
import {runnableBridge} from "@agenta/entities/runnable"
import {setOnSelectionChangeCallback, setRunnableBridge} from "@agenta/playground"
import {atom, getDefaultStore} from "jotai"
import {atomFamily} from "jotai/utils"

import {drawerVariantIdAtom} from "@/oss/components/VariantsComponents/Drawers/VariantDrawer/store/variantDrawerStore"
import {writePlaygroundSelectionToQuery} from "@/oss/state/url/playground"

type PromptsUpdater = unknown[] | ((prev: unknown[]) => unknown[])

/**
 * Backwards-compatible prompts atom backed by legacyAppRevision molecule data.
 * New code should prefer importing molecule selectors/reducers directly.
 */
export const moleculeBackedPromptsAtomFamily = atomFamily((revisionId: string) =>
    atom(
        (get) => get(legacyAppRevisionMolecule.selectors.data(revisionId))?.prompts ?? [],
        (get, set, next: PromptsUpdater) => {
            const entity = get(legacyAppRevisionMolecule.selectors.data(revisionId))
            if (!entity) return

            const prevPrompts = Array.isArray(entity.prompts) ? entity.prompts : []
            const nextPrompts = typeof next === "function" ? next(prevPrompts) : next

            set(legacyAppRevisionMolecule.reducers.update, revisionId, {
                prompts: Array.isArray(nextPrompts) ? nextPrompts : prevPrompts,
            })
        },
    ),
)

// ============================================================================
// RUNNABLE BRIDGE REGISTRATION
// Wire the configured runnableBridge into the playground package
// ============================================================================

setRunnableBridge(runnableBridge)

// ============================================================================
// SELECTION CHANGE CALLBACK
// OSS-specific side-effects when playground selection changes
// ============================================================================

setOnSelectionChangeCallback((entityIds, _removed) => {
    // Sync selection to URL
    void writePlaygroundSelectionToQuery(entityIds)

    // Keep drawer selection consistent
    const store = getDefaultStore()
    const currentDrawerId = store.get(drawerVariantIdAtom)
    if (!currentDrawerId || !entityIds.includes(currentDrawerId)) {
        store.set(drawerVariantIdAtom, entityIds[0] ?? null)
    }
})
