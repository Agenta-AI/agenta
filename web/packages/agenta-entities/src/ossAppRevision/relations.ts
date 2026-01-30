/**
 * OssAppRevision Entity Relations
 *
 * Defines the parent-child relationships for OSS app revision entities:
 * - app → variant
 * - variant → ossAppRevision
 *
 * These relations enable:
 * - Selection adapter generation (EntityPicker)
 * - Hierarchy navigation in cascading selectors
 * - Unified entity discovery
 *
 * Note: This mirrors the appRevision relations but uses the legacy API endpoints.
 *
 * @example
 * ```typescript
 * import { ossAppToVariantRelation, ossVariantToRevisionRelation } from '@agenta/entities/ossAppRevision'
 * import { entityRelationRegistry } from '@agenta/entities/shared'
 *
 * // Relations are auto-registered when this module is imported
 * const path = entityRelationRegistry.getPath("app", "ossAppRevision")
 * // Returns: ["app", "variant", "ossAppRevision"]
 * ```
 */

import {atom} from "jotai"

import type {EntityRelation, ListQueryState} from "../shared/molecule/types"
import {entityRelationRegistry} from "../shared/relations/registry"

import {ossAppRevisionMolecule} from "./state/molecule"
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
export const ossAppsListAtom = atom<ListQueryState<AppListItem>>((get) => {
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
export interface OssAppRootEntity {
    id: string
    name: string
}

// ============================================================================
// APP → VARIANT RELATION
// ============================================================================

/**
 * Creates a ListQueryState from the variants list query.
 */
const ossVariantListAtomFamily = (appId: string) =>
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
 * Relation from app to its variants (OSS version).
 *
 * Apps contain multiple variants (different configurations/prompts).
 * This relation enables the second level of the app → variant → revision hierarchy.
 *
 * Note: childMolecule is undefined because variants are intermediate entities
 * without their own molecule. The selection adapter uses listAtomFamily for dropdown.
 */
export const ossAppToVariantRelation: EntityRelation<AppListItem, VariantListItem> = {
    name: "ossVariants",
    parentType: "app",
    childType: "ossVariant",

    // Apps don't embed variant IDs in a simple field - they're fetched via API
    childIdsPath: () => [],

    // No embedded data
    childDataPath: undefined,

    // Reference mode - variants are fetched separately
    mode: "reference",

    // No child molecule for variants (they're intermediate entities)

    childMolecule: undefined as any,

    // List atom for selection UI
    listAtomFamily: ossVariantListAtomFamily,

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
const ossRevisionListAtomFamily = (variantId: string) =>
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
 * Relation from variant to its revisions (OSS version).
 *
 * Each variant can have multiple revisions (version history).
 * This is the leaf level of the app → variant → revision hierarchy.
 *
 * Note: Type assertion needed because molecule data type (OssAppRevisionData)
 * differs from list item type (RevisionListItem).
 */
export const ossVariantToRevisionRelation: EntityRelation<VariantListItem, RevisionListItem> = {
    name: "ossRevisions",
    parentType: "ossVariant",
    childType: "ossAppRevision",

    // Variants don't embed revision IDs - they're fetched via API
    childIdsPath: () => [],

    // No embedded data
    childDataPath: undefined,

    // Reference mode - revisions are fetched separately
    mode: "reference",

    // Child molecule for fetching full revision data

    childMolecule: ossAppRevisionMolecule as any,

    // List atom for selection UI
    listAtomFamily: ossRevisionListAtomFamily,

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
 * Register all OSS app revision relations.
 * Called automatically when this module is imported.
 */
export function registerOssAppRevisionRelations(): void {
    entityRelationRegistry.register(ossAppToVariantRelation)
    entityRelationRegistry.register(ossVariantToRevisionRelation)
}

// Auto-register on import
registerOssAppRevisionRelations()

// ============================================================================
// EXPORTS FOR SELECTION ADAPTERS
// ============================================================================

/**
 * Re-export list item types for adapter use.
 */
export type {AppListItem, VariantListItem, RevisionListItem}
