/**
 * AppRevision Entity Relations
 *
 * Defines the parent-child relationships for app revision entities:
 * - app → variant
 * - variant → appRevision
 *
 * These relations enable:
 * - Selection adapter generation (EntityPicker)
 * - Hierarchy navigation in cascading selectors
 * - Unified entity discovery
 *
 * @example
 * ```typescript
 * import { appToVariantRelation, variantToRevisionRelation } from '@agenta/entities/appRevision'
 * import { entityRelationRegistry } from '@agenta/entities/shared'
 *
 * // Relations are auto-registered when this module is imported
 * const path = entityRelationRegistry.getPath("app", "appRevision")
 * // Returns: ["app", "variant", "appRevision"]
 * ```
 */

import {atom} from "jotai"

import type {EntityRelation, ListQueryState} from "../shared/molecule/types"
import {entityRelationRegistry} from "../shared/relations/registry"

import {appRevisionMolecule} from "./state/molecule"
import {
    appsQueryAtom,
    variantsQueryAtomFamily,
    revisionsQueryAtomFamily,
    type AppListItem,
    type VariantListItem,
    type RevisionListItem,
} from "./state/store"

// ============================================================================
// APP LIST ATOM (ROOT LEVEL)
// ============================================================================

/**
 * Wraps the apps query to provide a ListQueryState for the root level.
 * This is a static atom (no parent ID) since apps are at the root.
 */
const appsListAtom = atom<ListQueryState<AppListItem>>((get) => {
    const query = get(appsQueryAtom)

    return {
        data: query.data ?? [],
        isPending: query.isPending ?? false,
        isError: query.isError ?? false,
        error: query.error ?? null,
    }
})

/**
 * Root-level relation type for apps.
 * Apps don't have a parent, so this is a special case.
 */
export interface AppRootEntity {
    id: string
    name: string
}

// ============================================================================
// APP → VARIANT RELATION
// ============================================================================

/**
 * Creates a ListQueryState from the variants list query.
 */
const variantListAtomFamily = (appId: string) =>
    atom<ListQueryState<VariantListItem>>((get) => {
        const query = get(variantsQueryAtomFamily(appId))

        return {
            data: query.data ?? [],
            isPending: query.isPending ?? false,
            isError: query.isError ?? false,
            error: query.error ?? null,
        }
    })

/**
 * Relation from app to its variants.
 *
 * Apps contain multiple variants (different configurations/prompts).
 * This relation enables the second level of the app → variant → revision hierarchy.
 *
 * Note: childMolecule is undefined because variants are intermediate entities
 * without their own molecule. The selection adapter uses listAtomFamily for dropdown.
 */
export const appToVariantRelation: EntityRelation<AppListItem, VariantListItem> = {
    name: "variants",
    parentType: "app",
    childType: "variant",

    // Apps don't embed variant IDs in a simple field - they're fetched via API
    childIdsPath: () => [],

    // No embedded data
    childDataPath: undefined,

    // Reference mode - variants are fetched separately
    mode: "reference",

    // No child molecule for variants (they're intermediate entities, not full entities)
    // The selection adapter uses listAtomFamily for dropdown population
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    childMolecule: undefined as any,

    // List atom for selection UI
    listAtomFamily: variantListAtomFamily,

    // Selection UI config
    selection: {
        label: "Variant",
        autoSelectSingle: true, // Auto-select if only one variant
        displayName: (entity: unknown) => {
            const variant = entity as VariantListItem
            return variant.name || variant.id.slice(0, 8)
        },
    },
}

// ============================================================================
// VARIANT → REVISION RELATION
// ============================================================================

/**
 * Creates a ListQueryState from the revisions list query.
 */
const revisionListAtomFamily = (variantId: string) =>
    atom<ListQueryState<RevisionListItem>>((get) => {
        const query = get(revisionsQueryAtomFamily(variantId))

        return {
            data: query.data ?? [],
            isPending: query.isPending ?? false,
            isError: query.isError ?? false,
            error: query.error ?? null,
        }
    })

/**
 * Relation from variant to its revisions.
 *
 * Each variant can have multiple revisions (version history).
 * This is the leaf level of the app → variant → revision hierarchy.
 *
 * Note: The relation uses RevisionListItem for list display, while appRevisionMolecule
 * provides full AppRevisionData when a revision is selected. Type assertion is used
 * because the molecule data type (AppRevisionData) differs from the list item type.
 */
export const variantToRevisionRelation: EntityRelation<VariantListItem, RevisionListItem> = {
    name: "revisions",
    parentType: "variant",
    childType: "appRevision",

    // Variants don't embed revision IDs - they're fetched via API
    childIdsPath: () => [],

    // No embedded data
    childDataPath: undefined,

    // Reference mode - revisions are fetched separately
    mode: "reference",

    // Child molecule for fetching full revision data
    // Note: Type assertion used because molecule data type (AppRevisionData)
    // differs from list item type (RevisionListItem)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    childMolecule: appRevisionMolecule as any,

    // List atom for selection UI
    listAtomFamily: revisionListAtomFamily,

    // Selection UI config
    selection: {
        label: "Revision",
        autoSelectSingle: true, // Auto-select if only one revision
        displayName: (entity: unknown) => {
            const revision = entity as RevisionListItem
            return `v${revision.revision ?? 0}`
        },
    },
}

// ============================================================================
// REGISTRATION
// ============================================================================

/**
 * Register all app revision relations.
 * Called automatically when this module is imported.
 */
export function registerAppRevisionRelations(): void {
    entityRelationRegistry.register(appToVariantRelation)
    entityRelationRegistry.register(variantToRevisionRelation)
}

// Auto-register on import
registerAppRevisionRelations()

// ============================================================================
// EXPORTS FOR SELECTION ADAPTERS
// ============================================================================

/**
 * Static apps list atom for root-level selection.
 * Used by selection adapters for the first level of hierarchy.
 */
export {appsListAtom}

/**
 * Re-export list item types for adapter use.
 */
export type {AppListItem, VariantListItem, RevisionListItem}
