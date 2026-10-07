import {useQuery} from "@tanstack/react-query"

import {fetchTopUpOffer} from "./api"

export const topUpOfferQueryKey = (projectId: string | null | undefined) =>
    ["billing", "topups", "offer", projectId] as const

/** The packs and whether this organization can buy one. A 403 means "not for you": no retry. */
export const useTopUpOffer = ({
    projectId,
    enabled = true,
}: {
    projectId?: string | null
    enabled?: boolean
}) =>
    useQuery({
        queryKey: topUpOfferQueryKey(projectId),
        queryFn: () => fetchTopUpOffer(projectId as string),
        enabled: enabled && Boolean(projectId),
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        retry: (count, error) =>
            (error as {response?: {status?: number}} | null)?.response?.status !== 403 && count < 2,
    })
