import {isWalletsEnabled} from "@agenta/shared/api"
import {useQuery} from "@tanstack/react-query"

import {fetchWalletSummary} from "./walletApi"

export const walletSummaryKey = (projectId: string) => ["wallet", "summary", projectId] as const

/** Polled, so credits visibly drop while agents run. Off entirely while the wallet is off. */
export const useWalletSummary = (
    projectId: string,
    /** `true` polls every 10 s, a number sets the interval in ms, `false` turns it off. */
    {poll = true}: {poll?: boolean | number} = {},
) =>
    useQuery({
        queryKey: walletSummaryKey(projectId),
        queryFn: () => fetchWalletSummary(projectId),
        enabled: isWalletsEnabled() && Boolean(projectId),
        staleTime: 5_000,
        refetchInterval: poll === true ? 10_000 : poll,
    })
