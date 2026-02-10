/**
 * LegacyAppRevision Factory
 *
 * Factory functions for creating local draft revisions.
 * Used for "Copy as Draft", "New Variant", and "Fork" workflows.
 *
 * @example
 * ```typescript
 * import { createLocalLegacyAppRevision } from '@agenta/entities/legacyAppRevision'
 *
 * // Create a new local draft from an existing revision
 * const { id, data } = createLocalLegacyAppRevision({
 *   variantId: 'variant-123',
 *   variantName: 'My Draft',
 *   sourceRevision: 5,
 *   parameters: existingParams,
 * })
 *
 * // Initialize in store
 * legacyAppRevisionMolecule.set.serverData(id, data)
 * ```
 */

import {generateLocalId} from "../../shared/utils/helpers"
import type {LegacyAppRevisionData} from "../core"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Parameters for creating a local OSS app revision draft
 */
export interface CreateLocalLegacyAppRevisionParams {
    /** The variant ID this draft belongs to */
    variantId: string
    /** The app ID this draft belongs to (for app-scoped storage) */
    appId?: string
    /** Display name for the variant */
    variantName?: string
    /** Source revision number (if copying from existing) */
    sourceRevision?: number | null
    /** Parameters/configuration for the revision */
    parameters?: Record<string, unknown>
    /** Enhanced prompts data */
    enhancedPrompts?: unknown[]
    /** Enhanced custom properties */
    enhancedCustomProperties?: Record<string, unknown>
    /** URI for fetching schema (important for custom apps) */
    uri?: string
}

/**
 * Result of creating a local OSS app revision
 */
export interface LocalLegacyAppRevision {
    /** Generated local draft ID */
    id: string
    /** The revision data */
    data: LegacyAppRevisionData
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a local draft revision that exists only in client state.
 *
 * This is used for workflows like:
 * - "Copy as Draft" - Clone an existing revision for editing
 * - "New Variant" - Create a fresh variant configuration
 * - "Fork" - Create a new variant based on another
 *
 * The generated ID uses the "local-" prefix which is recognized by
 * `isLocalDraftId()` and prevents server queries for this entity.
 *
 * @param params - Configuration for the new draft
 * @returns Object containing the generated ID and data
 *
 * @example
 * ```typescript
 * // Copy existing revision as draft
 * const existingData = legacyAppRevisionMolecule.get.data(existingId)
 * const { id, data } = createLocalLegacyAppRevision({
 *   variantId: existingData.variantId,
 *   variantName: `${existingData.variantName} (Copy)`,
 *   sourceRevision: existingData.revision,
 *   parameters: existingData.parameters,
 *   enhancedPrompts: existingData.enhancedPrompts,
 * })
 *
 * // Create empty new variant
 * const { id, data } = createLocalLegacyAppRevision({
 *   variantId: 'new-variant-id',
 *   variantName: 'New Variant',
 * })
 * ```
 */
export function createLocalLegacyAppRevision(
    params: CreateLocalLegacyAppRevisionParams,
): LocalLegacyAppRevision {
    const {
        variantId,
        appId,
        variantName = "New Variant",
        sourceRevision = null,
        parameters = {},
        enhancedPrompts = [],
        enhancedCustomProperties = {},
        uri,
    } = params

    // Generate a local draft ID
    // Format: "local-{timestamp}-{random}" which is recognized by isLocalDraftId()
    const id = generateLocalId("local")

    const data: LegacyAppRevisionData = {
        // Core identity
        id,
        variantId,
        appId,
        variantName,

        // Version info - use source revision or 0 for new drafts
        revision: sourceRevision ?? 0,

        // Configuration
        parameters,

        // Enhanced data for UI
        enhancedPrompts,
        enhancedCustomProperties,

        // URI for schema fetching (important for custom apps)
        uri,
    }

    return {id, data}
}

/**
 * Create a local draft by cloning an existing revision.
 *
 * Convenience wrapper around `createLocalLegacyAppRevision` that takes
 * an existing revision and creates a copy with optional overrides.
 *
 * @param source - The source revision data to clone
 * @param overrides - Optional overrides for the cloned data
 * @returns Object containing the generated ID and data
 *
 * @example
 * ```typescript
 * const source = legacyAppRevisionMolecule.get.data(revisionId)
 * const { id, data } = cloneAsLocalDraft(source, {
 *   variantName: `${source.variantName} (Copy)`,
 * })
 * ```
 */
export function cloneAsLocalDraft(
    source: LegacyAppRevisionData,
    overrides?: Partial<CreateLocalLegacyAppRevisionParams>,
): LocalLegacyAppRevision {
    const variantId = overrides?.variantId ?? source.variantId
    if (!variantId) {
        throw new Error("Cannot clone revision: variantId is required")
    }

    return createLocalLegacyAppRevision({
        variantId,
        appId: overrides?.appId ?? source.appId,
        variantName: overrides?.variantName ?? `${source.variantName ?? "Variant"} (Copy)`,
        sourceRevision: source.revision,
        parameters: overrides?.parameters ?? source.parameters,
        enhancedPrompts: overrides?.enhancedPrompts ?? source.enhancedPrompts,
        enhancedCustomProperties:
            overrides?.enhancedCustomProperties ?? source.enhancedCustomProperties,
        // Copy URI for schema fetching (critical for custom apps)
        uri: overrides?.uri ?? source.uri,
    })
}
