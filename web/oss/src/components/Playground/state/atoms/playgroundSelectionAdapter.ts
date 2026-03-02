/**
 * Playground Selection Adapter
 *
 * Uses createLegacyAppRevisionAdapter from @agenta/entity-ui in 2-level mode
 * (Variant → Revision) with local drafts support.
 *
 * Local drafts are managed at the entity level in @agenta/entities/legacyAppRevision.
 * This module provides a factory function to create an adapter scoped to a specific app,
 * using entity-level atoms directly (single source of truth).
 *
 * @example
 * ```typescript
 * import { createPlaygroundSelectionAdapter } from './playgroundSelectionAdapter'
 * import { EntityPicker } from '@agenta/entity-ui/selection'
 *
 * // Create adapter scoped to current app
 * const adapter = useMemo(() => createPlaygroundSelectionAdapter(appId), [appId])
 *
 * <EntityPicker
 *     variant="tree-select"
 *     adapter={adapter}
 *     onSelect={handleSelect}
 * />
 * ```
 */

import {
    createLegacyAppRevisionAdapter,
    type LegacyAppRevisionSelectionResult,
} from "@agenta/entity-ui/selection"

// ============================================================================
// ADAPTER FACTORY
// ============================================================================

/**
 * Create a playground selection adapter scoped to a specific app.
 *
 * Uses entity-level atoms directly from @agenta/entities/legacyAppRevision,
 * maintaining single source of truth for data fetching.
 *
 * @param appId - The app ID to scope the adapter to
 * @param options - Optional overrides
 * @returns An EntitySelectionAdapter for the playground
 */
export function createPlaygroundSelectionAdapter(
    appId: string,
    options: {
        includeLocalDrafts?: boolean
    } = {},
) {
    const {includeLocalDrafts = true} = options

    return createLegacyAppRevisionAdapter({
        appId,
        includeLocalDrafts,
        excludeRevisionZero: true,
        variantOverrides: {
            getLabel: (v: unknown) => {
                const variant = v as {
                    name?: string
                    id?: string
                    isLocalDraftGroup?: boolean
                    _draftCount?: number
                }
                if (variant.isLocalDraftGroup) {
                    return `Local Drafts (${variant._draftCount ?? 0})`
                }
                return variant.name ?? variant.id ?? "Unnamed"
            },
        },
        revisionOverrides: {
            getLabel: (r: unknown) => {
                const rev = r as {revision?: number; isLocalDraft?: boolean}
                if (rev.isLocalDraft) {
                    return `Draft (v${rev.revision ?? 0})`
                }
                return `v${rev.revision ?? 0}`
            },
        },
        toSelection: (path, leafEntity) => {
            const revision = leafEntity as {
                id: string
                revision?: number
                isLocalDraft?: boolean
                variantName?: string
                sourceRevisionId?: string
            }
            const variant = path[0]

            return {
                type: "legacyAppRevision",
                id: revision.id,
                label: revision.isLocalDraft
                    ? `Draft (${revision.variantName} v${revision.revision ?? 0})`
                    : `${variant?.label ?? "Variant"} v${revision.revision ?? 0}`,
                path,
                metadata: {
                    appId,
                    appName: "",
                    variantId: variant?.id ?? "",
                    variantName: variant?.label ?? "",
                    revision: revision.revision ?? 0,
                    isLocalDraft: revision.isLocalDraft ?? false,
                    sourceRevisionId: revision.sourceRevisionId,
                },
            } as LegacyAppRevisionSelectionResult
        },
        emptyMessage: "No variants found",
        loadingMessage: "Loading variants...",
    })
}

// Re-export for backwards compatibility
export type PlaygroundRevisionSelectionResult = LegacyAppRevisionSelectionResult
