/**
 * OSS App Revision Selection Adapter (Relation-Based)
 *
 * Adapter for selecting OSS app revisions through the hierarchy:
 * - 3-level: App → Variant → Revision (default)
 * - 2-level: Variant → Revision (when variantsListAtom is provided)
 *
 * Uses EntityRelation definitions from @agenta/entities/legacyAppRevision.
 * This implementation uses the relation-based factory pattern, eliminating
 * boilerplate code and runtime configuration.
 *
 * Note: This mirrors the appRevisionAdapter but uses the legacy API endpoints
 * via legacyAppRevision relations.
 *
 * @example
 * ```typescript
 * // 3-level mode (default)
 * import { legacyAppRevisionAdapter, LegacyAppRevisionSelectionResult } from '@agenta/entity-ui/selection'
 *
 * <EntityPicker adapter={legacyAppRevisionAdapter} onSelect={handleSelect} />
 *
 * // 2-level mode (scoped to current app)
 * import { createLegacyAppRevisionAdapter } from '@agenta/entity-ui/selection'
 *
 * const playgroundAdapter = createLegacyAppRevisionAdapter({
 *   variantsListAtom: myVariantsListAtom, // Scoped to current app
 *   revisionsListAtomFamily: myRevisionsAtomFamily, // Optional: inject local drafts
 * })
 * ```
 */

import React from "react"

// Import relations and atoms from the legacyAppRevision module
import {
    ossAppsListAtom,
    ossAppToVariantRelation,
    ossVariantToRevisionRelation,
    variantsListWithDraftsAtomFamily,
    revisionsListWithDraftsAtomFamily,
    variantsListQueryStateAtomFamily,
    revisionsListQueryStateAtomFamily,
} from "@agenta/entities/legacyAppRevision"
import type {EntityRelation} from "@agenta/entities/shared"
import {
    AppListItemLabel,
    RevisionLabel,
    VariantListItemLabel,
} from "@agenta/ui/components/presentational"
import type {Atom} from "jotai"

import type {
    EntitySelectionAdapter,
    EntitySelectionResult,
    ListQueryState,
    SelectionPathItem,
} from "../types"

import {createThreeLevelAdapter, createTwoLevelAdapter} from "./createAdapterFromRelations"

// ============================================================================
// TYPES
// ============================================================================

export interface LegacyAppRevisionSelectionResult extends EntitySelectionResult {
    type: "legacyAppRevision"
    metadata: {
        appId: string
        appName: string
        variantId: string
        variantName: string
        revision: number
    }
}

// ============================================================================
// ADAPTER
// ============================================================================

/**
 * OSS App Revision selection adapter using relation-based factory.
 *
 * Hierarchy: App → Variant → Revision
 *
 * This adapter is created at module load time using the atoms and relations
 * defined in the legacyAppRevision module. No runtime configuration required.
 *
 * Uses the legacy backend API (AppVariantRevision model) via legacyAppRevision.
 */
export const legacyAppRevisionAdapter = createThreeLevelAdapter<LegacyAppRevisionSelectionResult>({
    name: "legacyAppRevision",
    grandparentType: "app",
    grandparentLabel: "Application",
    grandparentListAtom: ossAppsListAtom as Atom<ListQueryState<unknown>>,
    grandparentOverrides: {
        getId: (app: unknown) => (app as {id: string}).id,
        getLabel: (app: unknown) => (app as {name: string}).name,
        getLabelNode: (app: unknown) => {
            const a = app as {name: string; appType?: string}
            return React.createElement(AppListItemLabel, {
                name: a.name,
                appType: a.appType,
                reserveSubtitleSpace: true,
            })
        },
        getPlaceholderNode: (text: string) =>
            React.createElement(AppListItemLabel, {
                name: text,
                reserveSubtitleSpace: true,
            }),
        hasChildren: true,
        isSelectable: false,
    },
    parentType: "ossVariant",
    parentLabel: "Variant",
    parentRelation: ossAppToVariantRelation as EntityRelation<unknown, unknown>,
    parentOverrides: {
        autoSelectSingle: true,
        getId: (variant: unknown) => {
            const v = variant as {variantId?: string; variant_id?: string; id?: string}
            return v.variantId ?? v.variant_id ?? v.id ?? ""
        },
        getLabel: (variant: unknown) => {
            const v = variant as {variantName?: string; variant_name?: string; name?: string}
            return v.variantName ?? v.variant_name ?? v.name ?? "Unnamed"
        },
        getLabelNode: (variant: unknown) => {
            const v = variant as {
                variantName?: string
                variant_name?: string
                name?: string
                baseName?: string
                base_name?: string
            }
            const name = v.variantName ?? v.variant_name ?? v.name ?? "Unnamed"
            const baseName = v.baseName ?? v.base_name
            return React.createElement(VariantListItemLabel, {
                name,
                baseName,
                reserveSubtitleSpace: true,
            })
        },
        getPlaceholderNode: (text: string) =>
            React.createElement(VariantListItemLabel, {
                name: text,
                reserveSubtitleSpace: true,
            }),
        hasChildren: true,
        isSelectable: false,
    },
    childType: "legacyAppRevision",
    childLabel: "Revision",
    childRelation: ossVariantToRevisionRelation as EntityRelation<unknown, unknown>,
    childOverrides: {
        autoSelectSingle: true,
        getLabelNode: (entity: unknown) => {
            const r = entity as {
                revision?: number
                commitMessage?: string
                createdAt?: string
                author?: string
            }
            return React.createElement(RevisionLabel, {
                version: r.revision ?? 0,
                message: r.commitMessage,
                createdAt: r.createdAt,
                author: r.author,
                maxMessageWidth: 180,
            })
        },
        getPlaceholderNode: (text: string) =>
            React.createElement(
                "div",
                {className: "flex flex-col gap-0.5"},
                React.createElement("span", {className: "text-zinc-400"}, text),
                React.createElement("span", {className: "invisible"}, "\u00A0"),
            ),
    },
    selectionType: "legacyAppRevision",
    toSelection: (
        path: SelectionPathItem[],
        leafEntity: unknown,
    ): LegacyAppRevisionSelectionResult => {
        const revision = leafEntity as {id: string; revision?: number}
        const app = path[0]
        const variant = path[1]
        const revisionItem = path[2]

        return {
            type: "legacyAppRevision",
            id: revision.id,
            label: `${app?.label ?? "App"} / ${variant?.label ?? "Variant"} / ${revisionItem?.label ?? "Revision"}`,
            path,
            metadata: {
                appId: app?.id ?? "",
                appName: app?.label ?? "",
                variantId: variant?.id ?? "",
                variantName: variant?.label ?? "",
                revision: revision.revision ?? 0,
            },
        }
    },
    emptyMessage: "No apps found",
    loadingMessage: "Loading apps...",
})

// ============================================================================
// CONFIGURABLE FACTORY
// ============================================================================

/**
 * Options for creating a configurable OSS App Revision adapter.
 */
export interface CreateLegacyAppRevisionAdapterOptions {
    /**
     * App ID to scope the adapter to (for 2-level mode).
     * When provided, uses entity-level variantsListWithDraftsAtomFamily(appId)
     * and revisionsListWithDraftsAtomFamily directly.
     * This is the recommended approach for single source of truth.
     */
    appId?: string

    /**
     * Atom that provides the current app ID dynamically.
     * Use this when the app ID comes from app state (e.g., currentAppAtom).
     * Takes precedence over static appId if both are provided.
     */
    appIdAtom?: Atom<string | null>

    /**
     * Whether to include local drafts in the list.
     * When true (default), uses variantsListWithDraftsAtomFamily.
     * When false, uses variantsListQueryStateAtomFamily.
     * @default true
     */
    includeLocalDrafts?: boolean

    /**
     * Whether to exclude revision 0 (initial/empty revisions) from the list.
     * @default false
     */
    excludeRevisionZero?: boolean

    /**
     * Custom variants list atom (for 2-level mode).
     * When provided, skips the app level and starts from variants.
     * Use this to scope variants to a specific app context.
     * @deprecated Use appId or appIdAtom instead for single source of truth.
     */
    variantsListAtom?: Atom<ListQueryState<unknown>>

    /**
     * Custom revisions list atom family.
     * When provided, overrides the default revision fetching.
     * Use this to inject local drafts or transform revision data.
     * @deprecated Use includeLocalDrafts instead for single source of truth.
     */
    revisionsListAtomFamily?: (variantId: string) => Atom<ListQueryState<unknown>>

    /**
     * Custom variant level overrides.
     */
    variantOverrides?: {
        getId?: (entity: unknown) => string
        getLabel?: (entity: unknown) => string
        getLabelNode?: (entity: unknown) => React.ReactNode
        hasChildren?: boolean | ((entity: unknown) => boolean)
        isSelectable?: boolean | ((entity: unknown) => boolean)
    }

    /**
     * Custom revision level overrides.
     */
    revisionOverrides?: {
        getId?: (entity: unknown) => string
        getLabel?: (entity: unknown) => string
        getLabelNode?: (entity: unknown) => React.ReactNode
    }

    /**
     * Custom selection builder.
     */
    toSelection?: (
        path: SelectionPathItem[],
        leafEntity: unknown,
    ) => LegacyAppRevisionSelectionResult

    /**
     * Empty state message.
     */
    emptyMessage?: string

    /**
     * Loading state message.
     */
    loadingMessage?: string
}

/**
 * Create a configurable OSS App Revision adapter.
 *
 * Supports two modes:
 * - **3-level mode** (default): App → Variant → Revision
 * - **2-level mode**: Variant → Revision (when `appId` or `variantsListAtom` is provided)
 *
 * @example
 * ```typescript
 * // 2-level mode using appId (recommended - single source of truth)
 * const playgroundAdapter = createLegacyAppRevisionAdapter({
 *   appId: currentAppId,
 *   includeLocalDrafts: true,
 * })
 *
 * // 2-level mode with custom atoms (legacy)
 * const playgroundAdapter = createLegacyAppRevisionAdapter({
 *   variantsListAtom: playgroundVariantsListAtom,
 *   revisionsListAtomFamily: playgroundRevisionsListAtomFamily,
 * })
 * ```
 */
export function createLegacyAppRevisionAdapter(
    options: CreateLegacyAppRevisionAdapterOptions = {},
): EntitySelectionAdapter<LegacyAppRevisionSelectionResult> {
    const {
        appId,
        appIdAtom,
        includeLocalDrafts = true,
        excludeRevisionZero = false,
        variantsListAtom,
        revisionsListAtomFamily,
        variantOverrides = {},
        revisionOverrides = {},
        toSelection,
        emptyMessage,
        loadingMessage,
    } = options

    // Determine the variants list atom to use
    let resolvedVariantsListAtom: Atom<ListQueryState<unknown>> | undefined = variantsListAtom

    // If appId is provided, use entity-level atoms directly (single source of truth)
    if (appId && !variantsListAtom) {
        const variantsFamily = includeLocalDrafts
            ? variantsListWithDraftsAtomFamily
            : variantsListQueryStateAtomFamily
        resolvedVariantsListAtom = variantsFamily(appId) as Atom<ListQueryState<unknown>>
    }

    // Determine the revisions list atom family to use
    let resolvedRevisionsListAtomFamily:
        | ((variantId: string) => Atom<ListQueryState<unknown>>)
        | undefined = revisionsListAtomFamily

    // If using entity-level atoms, use the appropriate revisions family
    if ((appId || appIdAtom) && !revisionsListAtomFamily) {
        const revisionsFamily = includeLocalDrafts
            ? revisionsListWithDraftsAtomFamily
            : revisionsListQueryStateAtomFamily
        resolvedRevisionsListAtomFamily = (variantId: string) =>
            revisionsFamily(variantId) as Atom<ListQueryState<unknown>>
    }

    // 2-level mode: Variant → Revision
    if (resolvedVariantsListAtom) {
        return createTwoLevelAdapter<LegacyAppRevisionSelectionResult>({
            name: "legacyAppRevision",
            parentType: "ossVariant",
            parentLabel: "Variant",
            parentListAtom: resolvedVariantsListAtom,
            parentOverrides: {
                getId: variantOverrides.getId ?? ((v: unknown) => (v as {id: string}).id ?? ""),
                getLabel:
                    variantOverrides.getLabel ??
                    ((v: unknown) => (v as {name: string}).name ?? "Unnamed"),
                // Don't provide default getLabelNode - let the tree use getLabel string directly
                // This avoids potential rendering issues with React.createElement in tree nodes
                getLabelNode: variantOverrides.getLabelNode,
                hasChildren: variantOverrides.hasChildren ?? true,
                isSelectable: variantOverrides.isSelectable ?? false,
            },
            childType: "legacyAppRevision",
            childLabel: "Revision",
            childRelation: resolvedRevisionsListAtomFamily
                ? ({
                      ...ossVariantToRevisionRelation,
                      listAtomFamily: resolvedRevisionsListAtomFamily,
                  } as EntityRelation<unknown, unknown>)
                : (ossVariantToRevisionRelation as EntityRelation<unknown, unknown>),
            childOverrides: {
                getId: revisionOverrides.getId ?? ((r: unknown) => (r as {id: string}).id ?? ""),
                getLabel:
                    revisionOverrides.getLabel ??
                    ((r: unknown) => {
                        const rev = r as {revision?: number}
                        return `v${rev.revision ?? 0}`
                    }),
                getLabelNode:
                    revisionOverrides.getLabelNode ??
                    ((r: unknown) => {
                        const rev = r as {
                            revision?: number
                            commitMessage?: string
                            createdAt?: string
                        }
                        return React.createElement(RevisionLabel, {
                            version: rev.revision ?? 0,
                            message: rev.commitMessage,
                            createdAt: rev.createdAt,
                            maxMessageWidth: 180,
                        })
                    }),
                // Filter out revision 0 if excludeRevisionZero is true
                filterItems: excludeRevisionZero
                    ? (r: unknown) => (r as {revision?: number}).revision !== 0
                    : undefined,
            },
            selectionType: "legacyAppRevision",
            toSelection:
                toSelection ??
                ((path, leafEntity) => {
                    const revision = leafEntity as {id: string; revision?: number}
                    const variant = path[0]

                    return {
                        type: "legacyAppRevision",
                        id: revision.id,
                        label: `${variant?.label ?? "Variant"} / v${revision.revision ?? 0}`,
                        path,
                        metadata: {
                            appId: appId ?? "",
                            appName: "",
                            variantId: variant?.id ?? "",
                            variantName: variant?.label ?? "",
                            revision: revision.revision ?? 0,
                        },
                    }
                }),
            emptyMessage: emptyMessage ?? "No variants found",
            loadingMessage: loadingMessage ?? "Loading variants...",
        })
    }

    // 3-level mode: App → Variant → Revision (default)
    return legacyAppRevisionAdapter
}
