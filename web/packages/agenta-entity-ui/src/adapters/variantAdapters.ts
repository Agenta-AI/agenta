/**
 * Variant Modal Adapters
 *
 * Registers the "variant" entity adapter for the unified modal system.
 * These adapters enable EntityCommitModal to work with playground variants.
 *
 * Commit context reads from runnableBridge, which routes to the correct
 * molecule (workflow, legacyAppRevision, etc.) based on entity type hints.
 * Commits are handled via the playground's onSubmit handler (workflow endpoint).
 */

import {
    legacyAppRevisionMolecule,
    type LegacyAppRevisionData,
} from "@agenta/entities/legacyAppRevision"
import {runnableBridge} from "@agenta/entities/runnable"
import {isLocalDraftId, getVersionLabel, formatLocalDraftLabel} from "@agenta/entities/shared"
import {stripAgentaMetadataDeep} from "@agenta/shared/utils"
import {atom} from "jotai"

import {
    createAndRegisterEntityAdapter,
    type CommitContext,
    type EntityModalAdapter,
} from "../modals"

// ============================================================================
// DATA ATOM
// ============================================================================

/**
 * OSS app revision data atom factory for modal adapter.
 * Reads from the molecule's data atom (includes draft changes).
 */
const legacyAppRevisionDataAtom = (id: string) =>
    atom((get) => {
        return get(legacyAppRevisionMolecule.atoms.data(id))
    })

// ============================================================================
// DIFF DATA HELPERS
// ============================================================================

function sortKeysDeep(value: unknown): unknown {
    if (value === null || value === undefined || typeof value !== "object") return value
    if (Array.isArray(value)) return value.map(sortKeysDeep)
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key])
    }
    return sorted
}

function stableStringify(value: unknown): string {
    return JSON.stringify(sortKeysDeep(value), null, 2)
}

/**
 * Build commit context for generic entities via runnableBridge.
 * Compares server configuration vs current configuration as JSON.
 */
function buildGenericCommitContext(
    currentConfig: Record<string, unknown> | null,
    serverConfig: Record<string, unknown> | null,
    version: number | undefined,
    isLocalDraft: boolean,
): CommitContext {
    const currentVersion = version ?? 0
    const targetVersion = currentVersion + 1

    const original = stableStringify({parameters: stripAgentaMetadataDeep(serverConfig ?? {})})
    const modified = stableStringify({parameters: stripAgentaMetadataDeep(currentConfig ?? {})})
    const hasDiff = original !== modified

    const descriptions: string[] = []
    if (hasDiff) descriptions.push("Configuration modified")
    if (isLocalDraft && descriptions.length === 0) {
        descriptions.push("New draft variant")
    }

    return {
        versionInfo: {
            currentVersion,
            targetVersion,
            latestVersion: currentVersion,
        },
        changesSummary:
            hasDiff || isLocalDraft
                ? {
                      modifiedCount: hasDiff ? 1 : 0,
                      description: descriptions.join(", "),
                  }
                : undefined,
        // Keep generic variant commits consistent with legacy commits: always
        // provide the preview payload and let the UI render zero-change state.
        diffData: {original, modified, language: "json"},
    }
}

/**
 * Commit context atom factory for variant.
 * Provides version info, changes summary, and diff data for the commit modal.
 *
 * Reads current and server configuration via runnableBridge, which routes
 * to the correct molecule (workflow, legacyAppRevision, etc.) based on
 * entity type hints.
 */
const variantCommitContextAtom = (revisionId: string, _metadata?: Record<string, unknown>) =>
    atom((get): CommitContext | null => {
        const isLocalDraft = isLocalDraftId(revisionId)
        const runnableData = get(runnableBridge.data(revisionId))
        const currentConfig = get(runnableBridge.configuration(revisionId))
        const serverConfig = get(runnableBridge.serverConfiguration(revisionId))

        if (!runnableData) return null

        return buildGenericCommitContext(
            currentConfig,
            serverConfig,
            runnableData.version,
            isLocalDraft,
        )
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
    // Variant deletion requires complex orchestration (selection updates, query
    // invalidation) that lives in the playground layer.
    throw new Error(
        "Variant deletion is not supported via the entity-ui adapter. " +
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
 * Commits are handled via the playground's onSubmit handler which routes through
 * the workflow endpoint (POST /preview/workflows/revisions/commit).
 */
export const variantModalAdapter: EntityModalAdapter<LegacyAppRevisionData> =
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
        dataAtom: legacyAppRevisionDataAtom,
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
 * import '@agenta/entity-ui/adapters/legacyAppRevisionAdapters'
 * ```
 */
