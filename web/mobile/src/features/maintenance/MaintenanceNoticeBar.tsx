import {useCallback, useEffect, useLayoutEffect, useRef, useState} from "react"

import {dismissNotice, isNoticeDismissed} from "@agenta/shared/analytics"
import {X} from "@phosphor-icons/react"
import {useRouter} from "next/router"

import {isAnalyticsAuthRoute} from "@/features/analytics/client"
import {cn} from "@/lib/utils"

import {useMaintenanceNotice} from "./useMaintenanceNotice"

/**
 * Two variables the full-height screens read (ScreenScaffold, AppShell, SessionWorkspace):
 * `--ag-top-bars-h` is taken off their viewport height, and `--ag-screen-safe-top` replaces
 * their top safe-area padding, because the bar owns that inset while it shows.
 */
const TOP_BARS_VAR = "--ag-top-bars-h"
const SCREEN_SAFE_TOP_VAR = "--ag-screen-safe-top"

/**
 * A bar above every screen for a planned event, driven by the `maintenance-notice` PostHog
 * flag. All its words come from the flag payload. It sits in the page flow and the message
 * wraps (a phone cannot show 240 characters on one line), so its height is measured and the
 * screen under it is shortened by exactly that, never covered.
 */
export const MaintenanceNoticeBar = () => {
    const notice = useMaintenanceNotice()
    const router = useRouter()
    const authRoute = isAnalyticsAuthRoute(router.asPath || router.pathname || "")
    // Start hidden: localStorage is not readable during the server render.
    const [dismissed, setDismissed] = useState(true)

    useEffect(() => {
        setDismissed(notice ? isNoticeDismissed(notice) : true)
    }, [notice])

    const visible = Boolean(notice) && !dismissed && !authRoute

    const barRef = useRef<HTMLDivElement>(null)

    useLayoutEffect(() => {
        const bar = barRef.current
        if (!visible || !bar) return
        const root = document.documentElement.style
        const publish = () =>
            root.setProperty(TOP_BARS_VAR, `${bar.getBoundingClientRect().height}px`)
        publish()
        root.setProperty(SCREEN_SAFE_TOP_VAR, "0px")
        const observer = new ResizeObserver(publish)
        observer.observe(bar)
        return () => {
            observer.disconnect()
            root.removeProperty(TOP_BARS_VAR)
            root.removeProperty(SCREEN_SAFE_TOP_VAR)
        }
    }, [visible])

    const handleDismiss = useCallback(() => {
        if (notice) dismissNotice(notice)
        setDismissed(true)
    }, [notice])

    if (!visible || !notice) return null

    return (
        <div
            ref={barRef}
            role="status"
            className={cn(
                "flex shrink-0 items-center gap-2 px-3 pt-[calc(8px+env(safe-area-inset-top))] pb-2 text-sm font-medium",
                notice.tone === "warning"
                    ? "border-b border-[var(--ag-status-warning-border)] bg-[var(--ag-status-warning-bg)] text-[var(--ag-status-warning-text)]"
                    : "bg-primary text-primary-foreground",
            )}
        >
            {/* Balances the close button so the text stays centred. */}
            <span aria-hidden className="size-6 shrink-0" />
            <p className="min-w-0 flex-1 text-center">
                {notice.message}
                {notice.linkHref ? (
                    <>
                        {" "}
                        <a
                            href={notice.linkHref}
                            target="_blank"
                            rel="noreferrer"
                            className="whitespace-nowrap underline underline-offset-2 hover:opacity-80"
                        >
                            {notice.linkLabel}
                        </a>
                    </>
                ) : null}
            </p>
            <button
                type="button"
                aria-label="Dismiss this notice"
                onClick={handleDismiss}
                className="grid size-6 shrink-0 place-items-center rounded hover:opacity-80"
            >
                <X size={14} />
            </button>
        </div>
    )
}
