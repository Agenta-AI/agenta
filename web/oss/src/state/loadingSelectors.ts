import {atom} from "jotai"
import {selectAtom} from "jotai/utils"

import {appsQueryAtom} from "@/oss/state/app/atoms/fetcher"
import {orgsQueryAtom, selectedOrgQueryAtom} from "@/oss/state/org/selectors/org"
import {profileQueryAtom} from "@/oss/state/profile/selectors/user"
import {projectsQueryAtom} from "@/oss/state/project/selectors/project"

import {variantsQueryAtom} from "./variant/atoms/fetcher"

// Centralised, reuse-safe status atoms. These are created once at module load
// and can be imported anywhere without recreating selector instances each render.

export const profilePendingAtom = selectAtom(profileQueryAtom, (q) => q.isPending)
export const appsPendingAtom = selectAtom(appsQueryAtom, (q) => q.isPending)
export const projectsPendingAtom = selectAtom(projectsQueryAtom, (q) => q.isPending)
export const orgsListPendingAtom = selectAtom(orgsQueryAtom, (q) => q.isPending)
export const orgDetailsPendingAtom = selectAtom(selectedOrgQueryAtom, (q) => q.isPending)
export const variantsPendingAtom = selectAtom(variantsQueryAtom, (q) => q.isPending)

// For atom families, we need to create a family of pending atoms
// Usage: get(variantRevisionsPendingFamily(variantId))
// export const variantRevisionsPendingFamily = atomFamily((variantId: string) =>
//     selectAtom(variantRevisionsQueryFamily(variantId), (q) => q.isPending),
// )

// Convenience atom to check if ANY variant revisions are currently loading
// This is useful for global loading states
export const anyVariantRevisionsPendingAtom = atom((get) => {
    // const variantsQuery = get(variantsQueryAtom)
    // if (variantsQuery.isPending) return true

    // const variants = variantsQuery.data || []
    // return variants.some((variant) => {
    //     const revisionsPending = get(variantRevisionsPendingFamily(variant.variantId))
    //     return revisionsPending
    // })
    return false
})

// Playground loading state - true if variants OR any revisions are loading
// This is the main loading state for playground components
export const playgroundLoadingAtom = atom((get) => {
    // If variants are still loading, playground is loading
    const variantsQuery = get(variantsQueryAtom)
    if (variantsQuery.isPending) return true

    // If any revisions are loading, playground is loading
    // const anyRevisionsPending = get(anyVariantRevisionsPendingAtom)
    // return anyRevisionsPending
    return false
})
