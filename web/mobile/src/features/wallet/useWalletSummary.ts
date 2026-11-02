import {isWalletsEnabled} from "@agenta/shared/api"
import {useQuery} from "@tanstack/react-query"

import {fetchWalletSummary} from "./walletApi"

/** Polled, so credits visibly drop while agents run. Off entirely while the wallet is off. */
export const useWalletSummary = (projectId: string, {poll = true}: {poll?: boolean} = {}) =>
    useQuery({
        queryKey: ["wallet", "summary", projectId],
        queryFn: () => fetchWalletSummary(projectId),
        enabled: isWalletsEnabled() && Boolean(projectId),
        refetchInterval: poll ? 10_000 : false,
    })
