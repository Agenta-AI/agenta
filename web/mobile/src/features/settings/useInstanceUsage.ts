import {isBillingEnabled} from "@agenta/shared/api"
import {useQuery} from "@tanstack/react-query"

import {fetchInstanceUsage} from "./licenseApi"

export const instanceUsageQueryKey = (projectId: string) => ["instance", "usage", projectId]

/**
 * Projects in this organization and organizations on the instance, against the plan limits.
 * Self-hosted only: cloud plans come from Stripe and the route does not answer.
 */
export const useInstanceUsage = (projectId: string, enabled = true) =>
    useQuery({
        queryKey: instanceUsageQueryKey(projectId),
        queryFn: () => fetchInstanceUsage(projectId),
        enabled: enabled && !isBillingEnabled() && Boolean(projectId),
        // Read again on each open: a project made a moment ago counts.
        staleTime: 0,
        refetchOnWindowFocus: false,
        retry: false,
    })
