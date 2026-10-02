import {isWalletsEnabled} from "@agenta/shared/api"
import Link from "next/link"

import {useWalletSummary} from "./useWalletSummary"
import {formatUsd} from "./walletFormat"

/**
 * Sidebar meter: spendable balance against the original total of the credits active now (there
 * is no monthly allowance yet). Opens the wallet's debug tab.
 */
export const CreditsRemainingWidget = ({
    projectId,
    settingsURL,
    collapsed,
}: {
    projectId: string
    settingsURL: string
    collapsed: boolean
}) => {
    const summary = useWalletSummary(projectId)
    if (!isWalletsEnabled() || collapsed || !summary.data) return null

    const remaining = Math.max(0, summary.data.spendable_musd ?? 0)
    const total = summary.data.active_credit_total_musd
    const ratio = total > 0 ? Math.min(1, remaining / total) : 0

    return (
        <Link
            href={`${settingsURL}?tab=walletUsage`}
            className="hover:bg-accent/50 mx-2 mb-1 flex flex-col gap-1.5 rounded-md px-2 py-2 text-xs no-underline"
        >
            <span className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Credits remaining</span>
                <span className="text-foreground tabular-nums">
                    {formatUsd(remaining)} of {formatUsd(total)}
                </span>
            </span>
            <span className="bg-muted block h-1 overflow-hidden rounded-full">
                <span
                    className="bg-primary block h-full rounded-full"
                    style={{width: `${ratio * 100}%`}}
                />
            </span>
        </Link>
    )
}
