import {useCallback, useEffect, useState} from "react"

import {
    dismissNotice,
    isNoticeDismissed,
    subscribeMaintenanceNotice,
    type MaintenanceNotice,
} from "@agenta/shared/analytics"
import {X} from "@phosphor-icons/react"
import clsx from "clsx"

import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"

/**
 * The maintenance notice bar for this app. The flag, payload parsing and dismissal live in
 * `@agenta/shared/analytics` (the /m app renders the same notice from them).
 *
 * WHAT THIS CANNOT DO: explain a browser certificate warning. The browser shows that
 * before our page is fetched, so no code of ours runs behind it.
 */

/** Reads the flag, and re-reads it when PostHog refreshes flags mid-session. */
export const useMaintenanceNotice = (): MaintenanceNotice | null => {
    const posthog = usePostHogAg()
    const [notice, setNotice] = useState<MaintenanceNotice | null>(null)

    useEffect(() => {
        if (!posthog) {
            setNotice(null)
            return
        }
        return subscribeMaintenanceNotice(posthog, setNotice)
    }, [posthog])

    return notice
}

interface Props {
    notice: MaintenanceNotice
    onDismissedChange?: (dismissed: boolean) => void
}

const MaintenanceNoticeBar = ({notice, onDismissedChange}: Props) => {
    // Start hidden: localStorage is not readable while rendering on the server, and a
    // bar that appears and then vanishes is worse than one that arrives a tick late.
    const [dismissed, setDismissed] = useState(true)

    useEffect(() => {
        const next = isNoticeDismissed(notice)
        setDismissed(next)
        onDismissedChange?.(next)
    }, [notice, onDismissedChange])

    const handleDismiss = useCallback(() => {
        dismissNotice(notice)
        setDismissed(true)
        onDismissedChange?.(true)
    }, [notice, onDismissedChange])

    if (dismissed) return null

    return (
        <>
            <div
                role="status"
                className={clsx([
                    "fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-2 h-[38px] px-10 text-sm font-medium",
                    notice.tone === "warning"
                        ? "border-0 border-b border-solid border-[var(--ag-status-warning-border)] bg-[var(--ag-status-warning-bg)] text-[var(--ag-status-warning-text)]"
                        : "bg-[var(--ag-c-1C2C3D)] text-white",
                ])}
            >
                <span className="truncate">{notice.message}</span>
                {notice.linkHref ? (
                    <a
                        href={notice.linkHref}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-inherit underline underline-offset-2 hover:opacity-80"
                    >
                        {notice.linkLabel}
                    </a>
                ) : null}
                <button
                    type="button"
                    aria-label="Dismiss this notice"
                    onClick={handleDismiss}
                    className="absolute right-3 grid h-6 w-6 place-items-center rounded border-none bg-transparent text-inherit cursor-pointer hover:opacity-80"
                >
                    <X size={14} />
                </button>
            </div>
            <div className="h-[38px] shrink-0" />
        </>
    )
}

export default MaintenanceNoticeBar
