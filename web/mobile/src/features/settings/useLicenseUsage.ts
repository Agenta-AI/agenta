import {isBillingEnabled} from "@agenta/shared/api"
import {useQuery, type QueryClient} from "@tanstack/react-query"

import {fetchLicenseUsage} from "./licenseApi"

const LICENSE_USAGE_KEY = ["instance", "licenseUsage"] as const

export const licenseUsageQueryKey = (projectId: string) => [...LICENSE_USAGE_KEY, projectId]

/**
 * Read the counts again after a change to them: a project or organization made or deleted, or
 * a license key added. Every organization's counts, since the key changes all their limits.
 */
export const invalidateLicenseUsage = (queryClient: QueryClient) =>
    queryClient.invalidateQueries({queryKey: LICENSE_USAGE_KEY})

/**
 * Projects in this organization and organizations on the instance, against the plan limits.
 * The one source of these counts for the License tab, Settings > Projects and the create
 * dialogs. Self-hosted only: cloud plans come from Stripe and the route does not answer.
 */
export const useLicenseUsage = (projectId: string, enabled = true) =>
    useQuery({
        queryKey: licenseUsageQueryKey(projectId),
        queryFn: () => fetchLicenseUsage(projectId),
        enabled: enabled && !isBillingEnabled() && Boolean(projectId),
        // Always stale: a create dialog that opens reads the counts again, and so does a
        // return to the tab, where a key activated in another tab lifts the limit.
        staleTime: 0,
        refetchOnWindowFocus: true,
        retry: false,
    })
