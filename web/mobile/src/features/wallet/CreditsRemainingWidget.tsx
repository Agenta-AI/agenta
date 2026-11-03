import {useEffect, useRef, useState} from "react"

import {isWalletsEnabled} from "@agenta/shared/api"
import Link from "next/link"

import {useWalletSummary} from "./useWalletSummary"
import {formatCredits} from "./walletFormat"

/**
 * Sidebar meter: spendable credits against the original total of the credits active now. Shown
 * only where the organization's wallet is enforced, the one mode where credits stop work. Opens
 * the Credits tab.
 */
export const CreditsRemainingWidget = ({
    projectId,
    settingsURL,
    collapsed,
}: {
    projectId: string
    settingsURL: string
    collapsed: boolean
}) =>
    // Not mounted while collapsed, so a hidden meter does not poll the summary.
    !isWalletsEnabled() || collapsed ? null : (
        <CreditsMeter projectId={projectId} settingsURL={settingsURL} />
    )

const CreditsMeter = ({projectId, settingsURL}: {projectId: string; settingsURL: string}) => {
    // The docked rail stays mounted under `display: none` on narrow screens; poll only on screen.
    const ref = useRef<HTMLDivElement>(null)
    const [onScreen, setOnScreen] = useState(false)
    useEffect(() => {
        const el = ref.current
        if (!el) return
        const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting))
        observer.observe(el)
        return () => observer.disconnect()
    }, [])
    const summary = useWalletSummary(projectId, {poll: onScreen})
    const data = summary.data?.mode === "enforce" ? summary.data : null

    const remaining = Math.max(0, data?.spendable_musd ?? 0)
    const total = data?.active_credit_total_musd ?? 0
    const ratio = total > 0 ? Math.min(1, remaining / total) : 0

    return (
        <div ref={ref}>
            {data && (
                <Link
                    href={`${settingsURL}?tab=credits`}
                    className="hover:bg-accent/50 mx-2 mb-1 flex flex-col gap-1.5 rounded-md px-2 py-2 text-xs no-underline"
                >
                    <span className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">Credits remaining</span>
                        <span className="text-foreground tabular-nums">
                            {formatCredits(remaining)} of {formatCredits(total)}
                        </span>
                    </span>
                    <span className="bg-muted block h-1 overflow-hidden rounded-full">
                        <span
                            className="bg-primary block h-full rounded-full"
                            style={{width: `${ratio * 100}%`}}
                        />
                    </span>
                </Link>
            )}
        </div>
    )
}
