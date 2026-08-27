/**
 * "Just changed" flash for file surfaces. Config sections mark agent self-commits against a
 * revision boundary; files have no such boundary, so recency here is TIME-based: a file whose
 * last touch (durable record recency ∪ live activity, via `DriveRecentFile.touchedAt`) is within
 * a short window reads as "just changed", and a lightweight clock ticks the indicators off after
 * the window elapses. The clock only runs WHILE something is recent, so idle surfaces don't
 * re-render.
 */
import {useEffect, useState} from "react"

export const RECENT_CHANGE_WINDOW_MS = 8000

/** True while `touchedAt` is within the flash window of `now`. */
export const isRecentlyChanged = (
    touchedAt: number | undefined,
    now: number,
    windowMs = RECENT_CHANGE_WINDOW_MS,
): boolean => touchedAt != null && now - touchedAt >= 0 && now - touchedAt < windowMs

/**
 * A `now` that ticks (1s) only while the drive's most-recent touch is inside the flash window,
 * then stops. Pass `drive.lastTouchedAt`; feed the returned `now` to {@link isRecentlyChanged}.
 */
export function useRecentChangeClock(
    lastTouchedAt: number | null,
    windowMs = RECENT_CHANGE_WINDOW_MS,
): number {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        if (lastTouchedAt == null || Date.now() - lastTouchedAt >= windowMs) return
        setNow(Date.now())
        const id = setInterval(() => {
            const t = Date.now()
            setNow(t)
            if (t - lastTouchedAt >= windowMs) clearInterval(id)
        }, 1000)
        return () => clearInterval(id)
    }, [lastTouchedAt, windowMs])
    return now
}
