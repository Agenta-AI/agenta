import {useCallback} from "react"

import {isBillingEnabled} from "@agenta/shared/api"
import {useQuery, useQueryClient} from "@tanstack/react-query"

import {
    dismissRegistrationOffer,
    fetchInstanceLicense,
    isNotInstanceAdmin,
    type InstanceLicense,
} from "./licenseApi"

export const instanceLicenseQueryKey = (projectId: string) => ["instance", "license", projectId]

/**
 * The instance license, for the License tab and for whether the reader is the instance admin.
 * Off where billing is on: those plans come from Stripe and the route does not answer.
 */
export const useInstanceLicense = (projectId: string) => {
    const query = useQuery({
        queryKey: instanceLicenseQueryKey(projectId),
        queryFn: () => fetchInstanceLicense(projectId),
        enabled: !isBillingEnabled() && Boolean(projectId),
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => !isNotInstanceAdmin(error) && failureCount < 2,
    })
    return {
        ...query,
        isInstanceAdmin: query.isSuccess,
        notInstanceAdmin: query.isError && isNotInstanceAdmin(query.error),
    }
}

/**
 * Records that the instance admin saw the registration offer: in the cached license at once, so
 * no other surface offers it again in this session, and on the instance, for every browser.
 */
export const useDismissRegistrationOffer = (projectId: string) => {
    const queryClient = useQueryClient()
    return useCallback(() => {
        // The dismissal is for the instance, so every project's cached copy says so.
        queryClient.setQueriesData<InstanceLicense>({queryKey: ["instance", "license"]}, (data) =>
            data ? {...data, registration_offer_dismissed: true} : data,
        )
        void dismissRegistrationOffer(projectId).catch(() => undefined)
    }, [projectId, queryClient])
}
