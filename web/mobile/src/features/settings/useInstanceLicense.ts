import {isBillingEnabled} from "@agenta/shared/api"
import {useQuery} from "@tanstack/react-query"

import {fetchInstanceLicense, isNotInstanceAdmin} from "./licenseApi"

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
