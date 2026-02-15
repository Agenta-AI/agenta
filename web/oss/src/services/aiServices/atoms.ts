/**
 * AI Services status atom — deduplicates status API calls across all components.
 *
 * Uses atomWithQuery so multiple PlaygroundVariantConfigPromptCollapseHeader
 * instances share a single cached request instead of N×M calls.
 */

import {atomWithQuery} from "jotai-tanstack-query"

import {aiServicesApi} from "./api"

export const aiServicesStatusQueryAtom = atomWithQuery(() => ({
    queryKey: ["ai-services-status"],
    queryFn: () => aiServicesApi.getStatus(),
    staleTime: 5 * 60_000, // Cache for 5 minutes
    refetchOnWindowFocus: false,
}))
