/**
 * App Revision Selection Adapter
 *
 * Adapter for selecting app revisions through the hierarchy:
 * App → Variant → Revision
 *
 * Uses the appRevisionMolecule from @agenta/entities/appRevision
 */

import {atom, type Atom} from "jotai"

import type {EntitySelectionResult, SelectionPathItem, ListQueryState} from "../types"

import {createAdapter} from "./createAdapter"
import {createRevisionLevel} from "./revisionLevelFactory"

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
// WRAPPER ATOMS
// ============================================================================

/**
 * These wrapper atoms convert the actual selector atoms to ListQueryState format.
 * They are configured by calling setAppRevisionAtoms() with the actual atoms.
 */

interface AppRevisionAtomConfig {
    appsAtom: Atom<unknown[]>
    variantsByAppFamily: (appId: string) => Atom<unknown[]>
    revisionsByVariantFamily: (variantId: string) => Atom<unknown[]>
}

let atomConfig: AppRevisionAtomConfig | null = null

/**
 * Configure the adapter with actual atoms from the app.
 * This should be called during app initialization.
 *
 * @example
 * ```typescript
 * import { appRevisionMolecule } from '@agenta/entities/appRevision'
 *
 * setAppRevisionAtoms({
 *   appsAtom: appRevisionMolecule.selectors.apps,
 *   variantsByAppFamily: appRevisionMolecule.selectors.variantsByApp,
 *   revisionsByVariantFamily: appRevisionMolecule.selectors.revisions,
 * })
 * ```
 */
export function setAppRevisionAtoms(config: AppRevisionAtomConfig): void {
    atomConfig = config
}

/**
 * Apps list atom wrapped for selection
 */
const appsListAtom = atom((get): ListQueryState<unknown> => {
    if (!atomConfig) {
        return {data: [], isPending: false, isError: false, error: null}
    }
    const data = get(atomConfig.appsAtom)
    return {data, isPending: false, isError: false, error: null}
})

/**
 * Variants by app atom family wrapped for selection
 */
function variantsByAppListAtom(appId: string): Atom<ListQueryState<unknown>> {
    return atom((get) => {
        if (!atomConfig) {
            return {data: [], isPending: false, isError: false, error: null}
        }
        const data = get(atomConfig.variantsByAppFamily(appId))
        return {data, isPending: false, isError: false, error: null}
    })
}

/**
 * Revisions by variant atom family wrapped for selection
 */
function revisionsByVariantListAtom(variantId: string): Atom<ListQueryState<unknown>> {
    return atom((get) => {
        if (!atomConfig) {
            return {data: [], isPending: false, isError: false, error: null}
        }
        const data = get(atomConfig.revisionsByVariantFamily(variantId))
        return {data, isPending: false, isError: false, error: null}
    })
}

// ============================================================================
// ADAPTER
// ============================================================================

/**
 * App Revision selection adapter
 *
 * Hierarchy: App → Variant → Revision
 *
 * @example
 * ```typescript
 * import { appRevisionAdapter } from '@agenta/entities/ui/selection'
 * import { useHierarchicalSelection } from '@agenta/entities/ui/selection'
 *
 * const { items, navigateDown, select } = useHierarchicalSelection({
 *   adapter: appRevisionAdapter,
 *   instanceId: 'my-selector',
 *   onSelect: (selection) => console.log('Selected revision:', selection),
 * })
 * ```
 */
export const appRevisionAdapter = createAdapter<AppRevisionSelectionResult>({
    name: "appRevision",
    entityType: "appRevision",
    levels: [
        {
            type: "app",
            listAtom: appsListAtom,
            getId: (app: unknown) => (app as {id: string}).id,
            getLabel: (app: unknown) => (app as {name: string}).name,
            hasChildren: () => true,
            isSelectable: () => false,
        },
        {
            type: "variant",
            listAtomFamily: variantsByAppListAtom,
            getId: (variant: unknown) => {
                const v = variant as {variantId?: string; variant_id?: string; id?: string}
                return v.variantId ?? v.variant_id ?? v.id ?? ""
            },
            getLabel: (variant: unknown) => {
                const v = variant as {variantName?: string; variant_name?: string; name?: string}
                return v.variantName ?? v.variant_name ?? v.name ?? "Unnamed"
            },
            hasChildren: () => true,
            isSelectable: () => false,
        },
        // Use shared revision level factory for git-based entity display
        createRevisionLevel({
            type: "appRevision",
            listAtomFamily: revisionsByVariantListAtom,
            fieldMappings: {
                version: "revision", // App revisions use 'revision' field
            },
        }),
    ],
    selectableLevel: 2,
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
