/**
 * Variant Modal Adapters
 *
 * Registers the "variant" entity adapter for the unified modal system.
 * These adapters enable EntityCommitModal to work with playground variants.
 *
 * Commit context reads from workflowMolecule selectors.
 * Commits are handled via the playground's onSubmit handler (workflow endpoint).
 */
import {isLocalDraftId, getVersionLabel, formatLocalDraftLabel} from "@agenta/entities/shared"
import {workflowMolecule, type Workflow} from "@agenta/entities/workflow"
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
 * Workflow revision data atom factory for modal adapter.
 * Reads from the molecule's data atom (includes draft changes).
 */
const workflowDataAtom = (id: string) =>
    atom((get) => {
        return get(workflowMolecule.selectors.data(id))
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
 * Build commit context for entities.
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
        diffData: {original, modified, language: "json"},
    }
}

/**
 * Commit context atom factory for variant.
 * Provides version info, changes summary, and diff data for the commit modal.
 *
 * Reads current and server configuration via workflowMolecule selectors.
 */
const variantCommitContextAtom = (revisionId: string, _metadata?: Record<string, unknown>) =>
    atom((get): CommitContext | null => {
        const isLocalDraft = isLocalDraftId(revisionId)
        const workflowData = get(workflowMolecule.selectors.data(revisionId))
        const currentConfig = get(workflowMolecule.selectors.configuration(revisionId))
        const serverConfig = get(workflowMolecule.selectors.serverConfiguration(revisionId))

        if (!workflowData) return null

        return buildGenericCommitContext(
            currentConfig,
            serverConfig,
            workflowData.version ?? undefined,
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
    throw new Error(
        "Variant deletion is not supported via the entity-ui adapter. " +
            "Use playground deleteVariantMutationAtom instead.",
    )
})

// ============================================================================
// ADAPTERS
// ============================================================================

/**
 * Variant (workflow revision) modal adapter.
 *
 * This adapter enables the EntityCommitModal to work with playground variants.
 * Commits are handled via the playground's onSubmit handler which routes through
 * the workflow endpoint (POST /workflows/revisions/commit).
 */
export const variantModalAdapter: EntityModalAdapter<Workflow> = createAndRegisterEntityAdapter({
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

        // Regular revision: show name and version
        const name = entity.name || "Variant"
        const version = entity.version ?? 0
        return `${name} ${getVersionLabel(version)}`
    },
    getDisplayLabel: (count) => (count === 1 ? "Variant" : "Variants"),
    deleteAtom: variantDeleteAtom,
    dataAtom: workflowDataAtom,
    canDelete: () => true,
    getDeleteWarning: () => null,
    commitContextAtom: variantCommitContextAtom,
    canCommit: (entity) => {
        if (!entity) return false
        return true
    },
})
