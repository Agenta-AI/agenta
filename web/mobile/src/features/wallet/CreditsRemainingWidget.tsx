import {useEffect, useRef, useState} from "react"

import {isWalletsEnabled} from "@agenta/shared/api"
import {AlertTriangle, XCircle, type LucideIcon} from "lucide-react"
import Link from "next/link"

import {creditAlert, type CreditAlert} from "./creditAlert"
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

interface MeterTone {
    text: string
    bar: string
    Icon: LucideIcon | null
}

const DEFAULT_TONE: MeterTone = {text: "text-foreground", bar: "bg-primary", Icon: null}
const METER_TONES: Partial<Record<CreditAlert["kind"], MeterTone>> = {
    low: {text: "text-colorWarningText", bar: "bg-colorWarning", Icon: AlertTriangle},
    empty: {text: "text-colorErrorText", bar: "bg-colorError", Icon: XCircle},
}

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
    // Fast only while credits need watching: this poll sets the rate for every reader of the summary.
    const [watching, setWatching] = useState(false)
    const summary = useWalletSummary(projectId, {
        poll: !onScreen ? false : watching ? true : 60_000,
    })
    const data = summary.data?.mode === "enforce" ? summary.data : null

    const remaining = Math.max(0, data?.spendable_musd ?? 0)
    const total = data?.active_credit_total_musd ?? 0
    const ratio = total > 0 ? Math.min(1, remaining / total) : 0
    const alertKind = creditAlert(data).kind
    useEffect(() => setWatching(alertKind !== "none"), [alertKind])
    const tone = METER_TONES[alertKind] ?? DEFAULT_TONE

    return (
        <div ref={ref}>
            {data && (
                <Link
                    href={`${settingsURL}?tab=credits`}
                    className="hover:bg-accent/50 mx-2 mb-1 flex flex-col gap-1.5 rounded-md px-2 py-2 text-xs no-underline"
                >
                    <span className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">Credits remaining</span>
                        <span className={`flex items-center gap-1 tabular-nums ${tone.text}`}>
                            {tone.Icon ? <tone.Icon className="size-3" /> : null}
                            {formatCredits(remaining)} of {formatCredits(total)}
                        </span>
                    </span>
                    <span className="bg-muted block h-1 overflow-hidden rounded-full">
                        <span
                            className={`block h-full rounded-full ${tone.bar}`}
                            style={{width: `${ratio * 100}%`}}
                        />
                    </span>
                </Link>
            )}
        </div>
    )
}
