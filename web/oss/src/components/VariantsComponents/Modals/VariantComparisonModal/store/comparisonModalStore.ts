import {
    workflowRevisionsByWorkflowListDataAtomFamily,
    workflowMolecule,
    type Workflow,
} from "@agenta/entities/workflow"
import {atom, Atom} from "jotai"

import {selectedAppIdAtom} from "@/oss/state/app/selectors/app"

import {registryPaginatedStore, type RegistryRevisionRow} from "../../../store/registryStore"
import {variantTableSelectionAtomFamily} from "../../../store/selectionAtoms"

/** Minimal revision shape used by the comparison modal */
export interface ComparisonRevision {
    id: string
    name?: string
    variantName?: string
    revision?: number | string
    parameters?: Record<string, unknown>
    createdAtTimestamp: number
    modifiedBy?: string
    createdBy?: string
    [key: string]: unknown
}

export type VariantAtom = Atom<ComparisonRevision[] | null>

interface ComparisonModalState {
    open: boolean
    compareListAtom?: VariantAtom
    allVariantsAtom?: VariantAtom
}

export const comparisonModalAtom = atom<ComparisonModalState>({
    open: false,
    compareListAtom: undefined,
    allVariantsAtom: undefined,
})

// Optional default selection scope used when no explicit compare list is provided
export const comparisonSelectionScopeAtom = atom<string | undefined>(undefined)

// Atom that holds all available revisions for the current scope
// Set by the dashboard before opening the modal
export const comparisonAllRevisionsAtom = atom<ComparisonRevision[]>([])

// Registry paginated store scopes that should read from the IVT selection
const REGISTRY_SCOPES = new Set(["registry-revisions", "overview-recent"])

export const openComparisonModalAtom = atom(
    null,
    (
        get,
        set,
        params?:
            | {
                  compareListAtom: VariantAtom
                  allVariantsAtom?: VariantAtom
              }
            | {
                  compareList: ComparisonRevision[]
                  allVariants?: ComparisonRevision[]
              },
    ) => {
        const currentState = get(comparisonModalAtom)

        // Toggle: if already open, close it
        if (currentState.open) {
            set(comparisonModalAtom, {
                open: false,
                compareListAtom: undefined,
                allVariantsAtom: undefined,
            })
            return
        }

        let compareListAtom: VariantAtom | undefined
        let allVariantsAtom: VariantAtom | undefined

        if (params) {
            if ("compareListAtom" in params) {
                compareListAtom = params.compareListAtom
                allVariantsAtom = params.allVariantsAtom
            } else {
                compareListAtom = atom(params.compareList || [])
                allVariantsAtom = params.allVariants ? atom(params.allVariants) : undefined
            }
        }

        set(comparisonModalAtom, {
            open: true,
            compareListAtom,
            allVariantsAtom,
        })
    },
)

export const closeComparisonModalAtom = atom(null, (_get, set) => {
    set(comparisonModalAtom, {
        open: false,
        compareListAtom: undefined,
        allVariantsAtom: undefined,
    })
})

/** Convert a workflow revision to the comparison shape */
function workflowToComparisonRevision(w: Workflow): ComparisonRevision {
    return {
        id: w.id,
        name: w.name ?? undefined,
        variantName: w.name ?? undefined,
        revision: w.version ?? undefined,
        parameters: (w.data?.parameters as Record<string, unknown>) ?? undefined,
        createdAtTimestamp: w.created_at ? new Date(w.created_at).valueOf() : 0,
        createdBy: w.created_by_id ?? undefined,
    }
}

/** Convert a registry row to the comparison shape.
 *  Parameters and createdBy are resolved from the molecule (fetched on demand). */
function registryRowToComparisonRevision(row: RegistryRevisionRow): ComparisonRevision {
    const entity = workflowMolecule.get.data(row.revisionId)
    return {
        id: row.revisionId,
        name: row.variantName,
        variantName: row.variantName,
        revision: row.version ?? undefined,
        parameters: (entity?.data?.parameters as Record<string, unknown>) ?? undefined,
        createdAtTimestamp: row.createdAt ? new Date(row.createdAt).valueOf() : 0,
        createdBy: entity?.created_by_id ?? undefined,
    }
}

/** Resolves the compare list: explicit atom > selection keys matched against store rows > fallback */
export const comparisonModalCompareListAtom = atom((get) => {
    const state = get(comparisonModalAtom)
    // Don't fetch revision data when the modal is closed
    if (!state.open) return []
    if (state.compareListAtom) return get(state.compareListAtom)

    // Resolve from selection scope + available revisions
    const scope = get(comparisonSelectionScopeAtom)
    if (scope) {
        // For registry scopes, read from the paginated store's selection + rows
        if (REGISTRY_SCOPES.has(scope)) {
            const controllerParams = {
                scopeId: scope,
                pageSize: scope === "overview-recent" ? 5 : 50,
            }
            const selectedKeys = get(registryPaginatedStore.selectors.selection(controllerParams))
            if (selectedKeys.length > 0) {
                const {rows} = get(registryPaginatedStore.selectors.state(controllerParams))
                const keySet = new Set(selectedKeys.map(String))
                return rows
                    .filter((r) => !r.__isSkeleton && keySet.has(String(r.key)))
                    .map(registryRowToComparisonRevision)
            }
        }

        // Fallback to old selection atom for other scopes
        const keys = get(variantTableSelectionAtomFamily(scope))
        const all = get(comparisonAllRevisionsAtom)
        if (keys.length > 0 && all.length > 0) {
            const keySet = new Set(keys.map(String))
            return all.filter((r) => keySet.has(String(r.id)))
        }
    }

    // default to workflow revisions list
    const rawAppId = get(selectedAppIdAtom)
    const appId = typeof rawAppId === "string" ? rawAppId : null
    if (!appId) return []
    const revisions = get(workflowRevisionsByWorkflowListDataAtomFamily(appId))
    return revisions.map(workflowToComparisonRevision)
})

export const comparisonModalAllVariantsAtom = atom((get) => {
    const state = get(comparisonModalAtom)
    // Don't fetch revision data when the modal is closed
    if (!state.open) return []
    if (state.allVariantsAtom) return get(state.allVariantsAtom)

    const all = get(comparisonAllRevisionsAtom)
    if (all.length > 0) return all

    // For registry scopes, use store rows
    const scope = get(comparisonSelectionScopeAtom)
    if (scope && REGISTRY_SCOPES.has(scope)) {
        const controllerParams = {scopeId: scope, pageSize: scope === "overview-recent" ? 5 : 50}
        const {rows} = get(registryPaginatedStore.selectors.state(controllerParams))
        return rows.filter((r) => !r.__isSkeleton).map(registryRowToComparisonRevision)
    }

    const rawAppId = get(selectedAppIdAtom)
    const appId = typeof rawAppId === "string" ? rawAppId : null
    if (!appId) return []
    const revisions = get(workflowRevisionsByWorkflowListDataAtomFamily(appId))
    return revisions.map(workflowToComparisonRevision)
})
