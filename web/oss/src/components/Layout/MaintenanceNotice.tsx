import {useCallback, useEffect, useMemo, useState} from "react"

import {X} from "@phosphor-icons/react"

import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"

/**
 * A bar across the top of the app for a planned event, driven entirely by a PostHog
 * feature flag. Nothing ships with a message in it: with the flag off, this renders
 * nothing and costs one boolean read.
 *
 * The words live in the flag's payload rather than in this file, so a notice can be
 * put up, reworded and taken down from PostHog without a deploy. That is the point:
 * during a migration window nobody wants to wait for a release to change a sentence.
 *
 * WHAT THIS CANNOT DO, and it is the first question people ask. It cannot explain a
 * browser certificate warning. That warning is shown by the browser before our page
 * is fetched, so no code of ours runs behind it. This bar reaches users who can load
 * the app: before the window, during an outage where the web still serves and the API
 * does not, and after they have clicked through a warning. For the warning itself the
 * only thing that works is telling people in advance.
 *
 * Payload shape, all fields optional except `message`:
 *
 *   {
 *     "id": "us-cutover-2026-10",   // changing it makes a dismissed bar come back
 *     "message": "...",
 *     "linkHref": "https://...",
 *     "linkLabel": "Read more",
 *     "tone": "info" | "warning"
 *   }
 */
export const MAINTENANCE_NOTICE_FLAG = "maintenance-notice"

const DISMISSED_KEY = "agenta:dismissed-maintenance-notice"

/** The bar is one line on a laptop. Longer text wraps and pushes the app down. */
const MAX_MESSAGE = 240
const MAX_LABEL = 40

export interface MaintenanceNotice {
    id: string
    message: string
    linkHref?: string
    linkLabel?: string
    tone: "info" | "warning"
}

const asText = (value: unknown, max: number): string | undefined => {
    if (typeof value !== "string") return undefined
    const trimmed = value.trim()
    if (!trimmed) return undefined
    return trimmed.slice(0, max)
}

/**
 * The payload is remote configuration, so treat it as data and not as something
 * well formed. A payload we cannot read is no notice, never a half-rendered bar.
 */
export const parseNotice = (payload: unknown): MaintenanceNotice | null => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
    const raw = payload as Record<string, unknown>

    const message = asText(raw.message, MAX_MESSAGE)
    if (!message) return null

    // Only http(s). A payload is not a place from which to run javascript: urls.
    let linkHref = asText(raw.linkHref, 2048)
    if (linkHref && !/^https?:\/\//i.test(linkHref)) linkHref = undefined

    return {
        id: asText(raw.id, 120) ?? message,
        message,
        linkHref,
        linkLabel: linkHref ? (asText(raw.linkLabel, MAX_LABEL) ?? "Read more") : undefined,
        tone: raw.tone === "warning" ? "warning" : "info",
    }
}

/** Reads the flag, and re-reads it when PostHog refreshes flags mid-session. */
export const useMaintenanceNotice = (): MaintenanceNotice | null => {
    const posthog = usePostHogAg()
    const [notice, setNotice] = useState<MaintenanceNotice | null>(null)

    useEffect(() => {
        if (!posthog) return

        const read = () => {
            if (!posthog.isFeatureEnabled(MAINTENANCE_NOTICE_FLAG)) {
                setNotice(null)
                return
            }
            setNotice(parseNotice(posthog.getFeatureFlagPayload(MAINTENANCE_NOTICE_FLAG)))
        }

        read()
        // onFeatureFlags returns its own unsubscribe in posthog-js; older builds return
        // nothing, so only call it back when it is a function.
        const unsubscribe = posthog.onFeatureFlags(read)
        return () => {
            if (typeof unsubscribe === "function") unsubscribe()
        }
    }, [posthog])

    return notice
}

const readDismissed = (): string | null => {
    try {
        return window.localStorage.getItem(DISMISSED_KEY)
    } catch {
        // Private windows and blocked site data both throw here. A bar that shows
        // again is better than a crash.
        return null
    }
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
        const next = readDismissed() === notice.id
        setDismissed(next)
        onDismissedChange?.(next)
    }, [notice.id, onDismissedChange])

    const handleDismiss = useCallback(() => {
        try {
            window.localStorage.setItem(DISMISSED_KEY, notice.id)
        } catch {
            // Nothing to do. The bar closes for this page either way.
        }
        setDismissed(true)
        onDismissedChange?.(true)
    }, [notice.id, onDismissedChange])

    const background = useMemo(
        () => (notice.tone === "warning" ? "var(--ag-c-7A4100, #7a4100)" : "var(--ag-c-1C2C3D)"),
        [notice.tone],
    )

    if (dismissed) return null

    return (
        <>
            <div
                role="status"
                className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-2 h-[38px] px-10 bg-[var(--ag-c-1C2C3D)] text-white text-sm font-medium"
                style={{background}}
            >
                <span className="truncate">{notice.message}</span>
                {notice.linkHref ? (
                    <a
                        href={notice.linkHref}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-white underline underline-offset-2 hover:opacity-80"
                    >
                        {notice.linkLabel}
                    </a>
                ) : null}
                <button
                    type="button"
                    aria-label="Dismiss this notice"
                    onClick={handleDismiss}
                    className="absolute right-3 grid h-6 w-6 place-items-center rounded border-none bg-transparent text-white cursor-pointer hover:opacity-80"
                >
                    <X size={14} />
                </button>
            </div>
            <div className="h-[38px] shrink-0" />
        </>
    )
}

export default MaintenanceNoticeBar
