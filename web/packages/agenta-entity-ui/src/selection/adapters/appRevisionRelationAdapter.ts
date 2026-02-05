/**
 * App Revision Selection Adapter (Relation-Based)
 *
 * Adapter for selecting app revisions through the hierarchy:
 * App → Variant → Revision
 *
 * Uses EntityRelation definitions from @agenta/entities/appRevision.
 * This implementation uses the relation-based factory pattern, eliminating
 * boilerplate code and runtime configuration.
 *
 * @example
 * ```typescript
 * import { appRevisionAdapter, AppRevisionSelectionResult } from '@agenta/entity-ui/selection'
 *
 * const { items, navigateDown, select } = useHierarchicalSelection({
 *   adapter: appRevisionAdapter,
 *   instanceId: 'my-selector',
 *   onSelect: (selection: AppRevisionSelectionResult) => {
 *     console.log('Selected revision:', selection.id)
 *   },
 * })
 * ```
 */

import React from "react"

// Import relations and atoms from the appRevision module
import {
    appsListAtom,
    appToVariantRelation,
    variantToRevisionRelation,
} from "@agenta/entities/appRevision"
import type {EntityRelation} from "@agenta/entities/shared"
import {
    AppListItemLabel,
    RevisionLabel,
    VariantListItemLabel,
} from "@agenta/ui/components/presentational"
import type {Atom} from "jotai"

import type {EntitySelectionResult, ListQueryState, SelectionPathItem} from "../types"

import {createThreeLevelAdapter} from "./createAdapterFromRelations"

// ============================================================================
// TYPES
// ============================================================================

export interface AppRevisionSelectionResult extends EntitySelectionResult {
    type: "appRevision"
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
 * App Revision selection adapter using relation-based factory.
 *
 * Hierarchy: App → Variant → Revision
 *
 * This adapter is created at module load time using the atoms and relations
 * defined in the appRevision module. No runtime configuration required.
 */
export const appRevisionAdapter = createThreeLevelAdapter<AppRevisionSelectionResult>({
    name: "appRevision",
    grandparentType: "app",
    grandparentLabel: "Application",
    grandparentListAtom: appsListAtom as Atom<ListQueryState<unknown>>,
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
    parentType: "variant",
    parentLabel: "Variant",
    parentRelation: appToVariantRelation as EntityRelation<unknown, unknown>,
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
    childType: "appRevision",
    childLabel: "Revision",
    childRelation: variantToRevisionRelation as EntityRelation<unknown, unknown>,
    childOverrides: {
        autoSelectSingle: true,
        getLabelNode: (entity: unknown) => {
            const r = entity as {
                version?: number
                commitMessage?: string
                createdAt?: string
                author?: string
            }
            return React.createElement(RevisionLabel, {
                version: r.version ?? 0,
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
    selectionType: "appRevision",
    toSelection: (path: SelectionPathItem[], leafEntity: unknown): AppRevisionSelectionResult => {
        const revision = leafEntity as {id: string; revision?: number; version?: number}
        const app = path[0]
        const variant = path[1]
        const revisionItem = path[2]

        return {
            type: "appRevision",
            id: revision.id,
            label: `${app?.label ?? "App"} / ${variant?.label ?? "Variant"} / ${revisionItem?.label ?? "Revision"}`,
            path,
            metadata: {
                appId: app?.id ?? "",
                appName: app?.label ?? "",
                variantId: variant?.id ?? "",
                variantName: variant?.label ?? "",
                revision: revision.revision ?? revision.version ?? 0,
            },
        }
    },
    emptyMessage: "No apps found",
    loadingMessage: "Loading apps...",
})
