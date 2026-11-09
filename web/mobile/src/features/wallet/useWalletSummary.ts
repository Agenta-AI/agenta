import {isWalletsEnabled} from "@agenta/shared/api"
import {useQuery} from "@tanstack/react-query"

import {fetchWalletSummary} from "./walletApi"

export const walletSummaryKey = (projectId: string) => ["wallet", "summary", projectId] as const

/** Polled, so credits visibly drop while agents run. Off entirely while the wallet is off. */
export const useWalletSummary = (projectId: string, {poll = true}: {poll?: boolean} = {}) =>
    useQuery({
        queryKey: walletSummaryKey(projectId),
        queryFn: () => fetchWalletSummary(projectId),
        enabled: isWalletsEnabled() && Boolean(projectId),
        refetchInterval: poll ? 10_000 : false,
    })
