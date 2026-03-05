/**
 * Variant Modal Adapters
 *
 * Registers the "variant" entity adapter for the unified modal system.
 * These adapters enable EntityCommitModal to work with playground variants.
 *
 * Commit context reads from runnableBridge, which routes to the correct
 * molecule (workflow, legacyAppRevision, etc.) based on entity type hints.
 *
 * The fallback commitAtom still uses legacyAppRevisionMolecule for non-playground
 * commit paths; the playground bypasses it via custom onSubmit.
 */

import {
    legacyAppRevisionMolecule,
    fetchOssRevisionById,
    type LegacyAppRevisionData,
    type CommitRevisionParams,
} from "@agenta/entities/legacyAppRevision"
import {
    enhancedPromptsToParameters,
    enhancedCustomPropertiesToParameters,
} from "@agenta/entities/legacyAppRevision/utils/parameterConversion"
import {runnableBridge} from "@agenta/entities/runnable"
import {isLocalDraftId, getVersionLabel, formatLocalDraftLabel} from "@agenta/entities/shared"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"

import {
    createAndRegisterEntityAdapter,
    type CommitContext,
    type CommitParams,
    type EntityModalAdapter,
} from "../modals"

/**
 * Extended type for legacy app revision data that includes draft-overlay fields.
 * The molecule's `data` atom merges draft fields (enhancedPrompts, enhancedCustomProperties)
 * into the base LegacyAppRevisionData at runtime.
 */
type LegacyAppRevisionDataWithDraft = Omit<LegacyAppRevisionData, "enhancedCustomProperties"> & {
    enhancedPrompts?: unknown[]
    enhancedCustomProperties?: Record<string, unknown> | unknown[]
}

function extractParametersCandidate(source: unknown): Record<string, unknown> | null {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
        return null
    }

    const obj = source as Record<string, unknown>

    const topLevelParameters = obj.parameters
    if (
        topLevelParameters &&
        typeof topLevelParameters === "object" &&
        !Array.isArray(topLevelParameters)
    ) {
        return topLevelParameters as Record<string, unknown>
    }

    const topLevelConfiguration = obj.configuration
    if (
        topLevelConfiguration &&
        typeof topLevelConfiguration === "object" &&
        !Array.isArray(topLevelConfiguration)
    ) {
        return topLevelConfiguration as Record<string, unknown>
    }

    const nestedData = obj.data
    if (!nestedData || typeof nestedData !== "object" || Array.isArray(nestedData)) {
        return null
    }

    const nested = nestedData as Record<string, unknown>

    const nestedParameters = nested.parameters
    if (
        nestedParameters &&
        typeof nestedParameters === "object" &&
        !Array.isArray(nestedParameters)
    ) {
        return nestedParameters as Record<string, unknown>
    }

    const nestedConfiguration = nested.configuration
    if (
        nestedConfiguration &&
        typeof nestedConfiguration === "object" &&
        !Array.isArray(nestedConfiguration)
    ) {
        return nestedConfiguration as Record<string, unknown>
    }

    return null
}

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

/**
 * Extract diffable parameters from revision data.
 * Uses raw parameters as source-of-truth and normalizes JSON-string fields
 * into nested objects for granular diffs.
 */
function buildComparableParameters(
    data: LegacyAppRevisionDataWithDraft | null,
    baseParameters?: Record<string, unknown>,
    explicitParameters?: Record<string, unknown> | null,
): Record<string, unknown> {
    if (!data) return {}

    const hasEnhancedPrompts = data.enhancedPrompts && Array.isArray(data.enhancedPrompts)
    const hasEnhancedCustomProps =
        data.enhancedCustomProperties &&
        typeof data.enhancedCustomProperties === "object" &&
        !Array.isArray(data.enhancedCustomProperties)
    const dataParameters = extractParametersCandidate(data)
    const hasExplicitParameters =
        explicitParameters !== null &&
        explicitParameters !== undefined &&
        typeof explicitParameters === "object" &&
        !Array.isArray(explicitParameters)
    const hasDraftParameters = !!dataParameters

    let params: Record<string, unknown>
    if (hasExplicitParameters) {
        params = {...(explicitParameters as Record<string, unknown>)}
    } else if (hasEnhancedPrompts || hasEnhancedCustomProps) {
        // Preserve direct parameter edits when present, then let enhanced fields
        // overlay their canonical values.
        if (hasDraftParameters) {
            params = {...(dataParameters as Record<string, unknown>)}
        } else {
            params = {...(baseParameters ?? {})}
        }
    } else if (hasDraftParameters) {
        params = {...(dataParameters as Record<string, unknown>)}
    } else if (baseParameters) {
        params = {...baseParameters}
    } else {
        params = {}
    }

    if (hasEnhancedPrompts) {
        params = enhancedPromptsToParameters(data.enhancedPrompts!, params)
    }

    if (hasEnhancedCustomProps) {
        params = enhancedCustomPropertiesToParameters(
            data.enhancedCustomProperties as Record<string, unknown>,
            params,
        )
    }

    return params
}

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

    const original = stableStringify({parameters: serverConfig ?? {}})
    const modified = stableStringify({parameters: currentConfig ?? {}})
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
 * import { registerCommitCallbacks } from '@agenta/entities/legacyAppRevision'
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
    const data = get(legacyAppRevisionMolecule.atoms.data(id))
    if (!data) {
        throw new Error(`Entity not found: ${id}`)
    }

    // Extract variantId - required for the API call.
    // Bridge data from playground sync may lack variantId. If missing,
    // fetch it directly from the API as a fallback.
    let variantId = data.variantId
    if (!variantId) {
        const projectId = get(projectIdAtom)
        if (projectId) {
            const fetched = await fetchOssRevisionById(id, projectId)
            variantId = fetched?.variantId
        }
    }
    if (!variantId) {
        throw new Error(`No variantId found for entity: ${id}`)
    }

    // Build parameters from enhanced data
    // The molecule stores enhanced prompts/custom props, but API expects ag_config format
    const parameters = buildComparableParameters(data)

    // The commit action handles the rest (API call, polling, callbacks)
    const commitParams: CommitRevisionParams = {
        revisionId: id,
        variantId,
        parameters,
        commitMessage: message,
    }

    const result = await set(legacyAppRevisionMolecule.actions.commit, commitParams)

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
 *
 * ## Commit Flow
 *
 * The adapter uses `legacyAppRevisionMolecule.actions.commit` which:
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
 * import { registerCommitCallbacks } from '@agenta/entities/legacyAppRevision'
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
 * import '@agenta/entity-ui/adapters/legacyAppRevisionAdapters'
 * ```
 */
