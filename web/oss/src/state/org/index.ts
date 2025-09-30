export * from "./selectors/org"
export * from "./hooks"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {resetOrgDataAtom} from "./selectors/org"

export const getOrgValues = () => {
    const store = getDefaultStore()
    const queryClient = store.get(queryClientAtom)

    // keys defined in selectors
    const orgsKey = ["orgs"]
    const selectedOrgKey = ["selectedOrg"]

    const orgsData = queryClient.getQueryData<any>(orgsKey)
    const orgsState = queryClient.getQueryState(orgsKey)

    // selectedOrg is keyed as ["selectedOrg", id] in selectors; prefer any matching entry
    let selectedData = queryClient.getQueryData<any>(selectedOrgKey)
    let selectedState = queryClient.getQueryState(selectedOrgKey)
    const multi = queryClient.getQueriesData<any>({queryKey: selectedOrgKey}) || []
    const fromList = multi.find(([, data]) => !!data)?.[1]
    if (fromList) selectedData = fromList
    // No direct API for combined state; best-effort: if any matching query is pending, treat as pending
    const anyPending = (queryClient.getQueryCache().findAll({queryKey: selectedOrgKey}) || []).some(
        (q: any) => q.state.status === "pending",
    )
    if (anyPending) selectedState = {status: "pending"} as any

    return {
        orgs: orgsData ?? [],
        selectedOrg: selectedData ?? null,
        isLoading: orgsState?.status === "pending" || selectedState?.status === "pending",
    }
}

export const resetOrgData = () => {
    const store = getDefaultStore()
    store.set(resetOrgDataAtom, null)
}
