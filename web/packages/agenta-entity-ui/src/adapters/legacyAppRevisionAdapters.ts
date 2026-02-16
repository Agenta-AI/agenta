/**
 * LegacyAppRevision Modal Adapters
 *
 * Registers legacyAppRevision (variant) entity adapter for the unified modal system.
 * These adapters enable EntityDeleteModal and EntityCommitModal to work with
 * OSS app revision entities (variants in the playground).
 *
 * Uses the unified entity API:
 * - `legacyAppRevisionMolecule.atoms.data(id)` - data with draft merged
 * - `legacyAppRevisionMolecule.atoms.serverData(id)` - raw server data
 * - `legacyAppRevisionMolecule.atoms.isDirty(id)` - check for unsaved changes
 * - `legacyAppRevisionMolecule.actions.commit` - commit with polling workaround
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
    legacyAppRevisionMolecule,
    type LegacyAppRevisionData,
    type CommitRevisionParams,
    stripVolatileKeys,
    enhancedPromptsToParameters,
    enhancedCustomPropertiesToParameters,
} from "@agenta/entities/legacyAppRevision"
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
const legacyAppRevisionDataAtom = (id: string) =>
    atom((get) => {
        return get(legacyAppRevisionMolecule.atoms.data(id))
    })

// ============================================================================
// DIFF DATA HELPERS
// ============================================================================

/**
 * Legacy prompt keys that are superseded by structured prompt format
 * and should not appear in the commit diff.
 */
const LEGACY_PROMPT_KEYS = new Set([
    "system_prompt",
    "user_prompt",
    "prompt_template",
    "temperature",
    "model",
    "max_tokens",
    "top_p",
    "frequency_penalty",
    "presence_penalty",
    "input_keys",
    "template_format",
])

/**
 * Parse JSON-like strings so prompt fields are diffed as nested objects
 * instead of a single JSON blob string.
 */
function parseStructuredString(value: string): unknown {
    const trimmed = value.trim()

    if (!trimmed) return value
    if (
        !(
            (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
            (trimmed.startsWith("[") && trimmed.endsWith("]"))
        )
    ) {
        return value
    }

    try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed === "object") return parsed
    } catch {
        // Keep original string when parsing fails.
    }

    return value
}

/**
 * Normalize values recursively for stable field-level diff rendering.
 */
function normalizeDiffValue(value: unknown): unknown {
    if (typeof value === "string") {
        const parsed = parseStructuredString(value)
        if (parsed !== value) return normalizeDiffValue(parsed)
        return value
    }

    if (Array.isArray(value)) {
        return value.map(normalizeDiffValue)
    }

    if (!value || typeof value !== "object") {
        return value
    }

    const normalized: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        normalized[key] = normalizeDiffValue(nested)
    }
    return normalized
}

/**
 * Strip flattened legacy prompt fields when structured prompt fields exist.
 */
function stripLegacyPromptFields(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(stripLegacyPromptFields)
    }

    if (!value || typeof value !== "object") {
        return value
    }

    const result: Record<string, unknown> = {...(value as Record<string, unknown>)}
    const hasStructuredPrompt = result.messages || result.llm_config || result.llmConfig

    if (hasStructuredPrompt) {
        for (const key of LEGACY_PROMPT_KEYS) {
            delete result[key]
        }
    }

    for (const [key, nested] of Object.entries(result)) {
        result[key] = stripLegacyPromptFields(nested)
    }

    return result
}

/**
 * Extract diffable parameters from revision data.
 * Uses raw parameters as source-of-truth and normalizes JSON-string fields
 * into nested objects for granular diffs.
 */
function buildComparableParameters(
    data: LegacyAppRevisionData | null,
    baseParameters?: Record<string, unknown>,
): Record<string, unknown> {
    if (!data) return {}

    const hasEnhancedPrompts = data.enhancedPrompts && Array.isArray(data.enhancedPrompts)
    const hasEnhancedCustomProps =
        data.enhancedCustomProperties && typeof data.enhancedCustomProperties === "object"

    let params: Record<string, unknown>
    if (hasEnhancedPrompts || hasEnhancedCustomProps) {
        params = {...(baseParameters ?? data.parameters ?? {})}
    } else {
        params = {...(data.parameters ?? {})}
    }

    if (hasEnhancedPrompts) {
        params = enhancedPromptsToParameters(data.enhancedPrompts!, params)
    }

    if (hasEnhancedCustomProps) {
        params = enhancedCustomPropertiesToParameters(data.enhancedCustomProperties!, params)
    }

    return params
}

function extractDiffableData(
    data: LegacyAppRevisionData | null,
    baseParameters?: Record<string, unknown>,
): Record<string, unknown> {
    if (!data) return {}

    const rawParameters = buildComparableParameters(data, baseParameters)
    const unwrappedParameters =
        rawParameters.ag_config &&
        typeof rawParameters.ag_config === "object" &&
        !Array.isArray(rawParameters.ag_config)
            ? (rawParameters.ag_config as Record<string, unknown>)
            : rawParameters

    const strippedParameters = stripVolatileKeys(unwrappedParameters, true)
    const normalizedParameters = normalizeDiffValue(strippedParameters)
    const cleanedParameters = stripLegacyPromptFields(normalizedParameters)

    return {
        parameters: cleanedParameters,
    }
}

function stableStringify(value: unknown): string {
    return JSON.stringify(value, null, 2)
}

function deepEqual(a: unknown, b: unknown): boolean {
    return stableStringify(a) === stableStringify(b)
}

function isPromptRelatedKey(key: string): boolean {
    return (
        key === "messages" ||
        key === "prompt" ||
        key === "llm_config" ||
        key === "llmConfig" ||
        key === "system_prompt" ||
        key === "user_prompt" ||
        key === "prompt_template" ||
        key === "template_format" ||
        key.toLowerCase().includes("prompt")
    )
}

function hasComparableContent(value: unknown): boolean {
    if (value === undefined) {
        return false
    }

    if (Array.isArray(value)) {
        return value.length > 0
    }

    if (value && typeof value === "object") {
        return Object.keys(value as Record<string, unknown>).length > 0
    }

    return true
}

function hasPromptContent(value: unknown): boolean {
    if (Array.isArray(value)) {
        return value.some(hasPromptContent)
    }

    if (!value || typeof value !== "object") {
        return false
    }

    const obj = value as Record<string, unknown>
    if (
        obj.messages ||
        obj.prompt ||
        obj.prompt_template ||
        obj.system_prompt ||
        obj.user_prompt ||
        obj.llm_config ||
        obj.llmConfig
    ) {
        return true
    }

    return Object.values(obj).some(hasPromptContent)
}

function getPromptOnlyValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(getPromptOnlyValue).filter((entry) => entry !== undefined)
    }

    if (!value || typeof value !== "object") {
        return undefined
    }

    const source = value as Record<string, unknown>
    const filtered: Record<string, unknown> = {}

    for (const [key, nested] of Object.entries(source)) {
        if (isPromptRelatedKey(key)) {
            filtered[key] = nested
            continue
        }

        const child = getPromptOnlyValue(nested)
        const hasChildContent = hasComparableContent(child)

        if (hasChildContent) {
            filtered[key] = child
        }
    }

    return Object.keys(filtered).length > 0 ? filtered : undefined
}

function getNonPromptOnlyValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(getNonPromptOnlyValue).filter((entry) => entry !== undefined)
    }

    if (value === null || value === undefined) {
        return value
    }

    if (typeof value !== "object") {
        return value
    }

    const source = value as Record<string, unknown>
    const filtered: Record<string, unknown> = {}

    for (const [key, nested] of Object.entries(source)) {
        if (isPromptRelatedKey(key)) {
            continue
        }

        const child = getNonPromptOnlyValue(nested)
        const hasChildContent = hasComparableContent(child)

        if (hasChildContent) {
            filtered[key] = child
        }
    }

    return Object.keys(filtered).length > 0 ? filtered : undefined
}

/**
 * Count changes between server and draft data.
 * Returns a simple summary of what changed.
 */
function countChanges(
    serverData: LegacyAppRevisionData | null,
    draftData: LegacyAppRevisionData | null,
): {promptChanges: number; propertyChanges: number; description?: string} {
    if (!draftData) {
        return {promptChanges: 0, propertyChanges: 0}
    }

    const original = extractDiffableData(serverData)
    const modified = extractDiffableData(draftData, serverData?.parameters)

    const hasAnyChanges = !deepEqual(original, modified)
    if (!hasAnyChanges) {
        return {promptChanges: 0, propertyChanges: 0}
    }

    const originalPrompt = getPromptOnlyValue(original)
    const modifiedPrompt = getPromptOnlyValue(modified)
    const hasPromptSections = hasPromptContent(original) || hasPromptContent(modified)
    const promptChanges =
        hasPromptSections && !deepEqual(originalPrompt ?? {}, modifiedPrompt ?? {}) ? 1 : 0
    const originalProperties = getNonPromptOnlyValue(original)
    const modifiedProperties = getNonPromptOnlyValue(modified)
    const propertyChanges = !deepEqual(originalProperties ?? {}, modifiedProperties ?? {}) ? 1 : 0

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
        const draftData = get(legacyAppRevisionMolecule.atoms.data(revisionId))
        if (!draftData) return null

        // Get server data for comparison
        const serverData = get(legacyAppRevisionMolecule.atoms.serverData(revisionId))

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
        const modifiedStructure = extractDiffableData(draftData, serverData?.parameters)

        const original = stableStringify(originalStructure)
        const modified = stableStringify(modifiedStructure)

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

    // Extract variantId - required for the API call
    // The variantId should be present in entity data via revision list enrichment
    const variantId = data.variantId
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
    // Variant deletion is handled by the playground layer
    // This is a placeholder to satisfy the adapter interface
    console.warn(
        "[legacyAppRevisionAdapter] Delete called but not implemented. " +
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
