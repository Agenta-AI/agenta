export * from "./selectors/organization"
export * from "./hooks"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {resetOrganizationDataAtom} from "./selectors/organization"

export const getOrganizationValues = () => {
    const store = getDefaultStore()
    const queryClient = store.get(queryClientAtom)

    // keys defined in selectors
    const organizationsKey = ["organizations"]
    const selectedOrganizationKey = ["selectedOrganization"]

    const organizationsData = queryClient.getQueryData<any>(organizationsKey)
    const organizationsState = queryClient.getQueryState(organizationsKey)

    // selectedOrganization is keyed as ["selectedOrganization", id] in selectors; prefer any matching entry
    let selectedData = queryClient.getQueryData<any>(selectedOrganizationKey)
    let selectedState = queryClient.getQueryState(selectedOrganizationKey)
    const multi = queryClient.getQueriesData<any>({queryKey: selectedOrganizationKey}) || []
    const fromList = multi.find(([, data]) => !!data)?.[1]
    if (fromList) selectedData = fromList
    // No direct API for combined state; best-effort: if any matching query is pending, treat as pending
    const anyPending = (queryClient.getQueryCache().findAll({queryKey: selectedOrganizationKey}) || []).some(
        (q: any) => q.state.status === "pending",
    )
    if (anyPending) selectedState = {status: "pending"} as any

    return {
        organizations: organizationsData ?? [],
        selectedOrganization: selectedData ?? null,
        isLoading: organizationsState?.status === "pending" || selectedState?.status === "pending",
    }
}

export const resetOrganizationData = () => {
    const store = getDefaultStore()
    store.set(resetOrganizationDataAtom, null)
}
