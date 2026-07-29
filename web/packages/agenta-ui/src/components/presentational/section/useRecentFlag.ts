import {useEffect, useState} from "react"

/**
 * True for `windowMs` after `at`, then false. A caller-owned "just happened" clock for
 * transient attention cues (e.g. a pulsing section indicator). Re-arms whenever `at`
 * changes, and self-stops with a single timer so idle surfaces don't re-render. Mirrors
 * the time-based recency the Drives files use, in a package-safe form.
 */
export function useRecentFlag(at: number | null | undefined, windowMs = 8000): boolean {
    const [recent, setRecent] = useState(() => at != null && Date.now() - at < windowMs)
    useEffect(() => {
        if (at == null) {
            setRecent(false)
            return
        }
        const elapsed = Date.now() - at
        if (elapsed >= windowMs) {
            setRecent(false)
            return
        }
        setRecent(true)
        const id = window.setTimeout(() => setRecent(false), windowMs - elapsed)
        return () => window.clearTimeout(id)
    }, [at, windowMs])
    return recent
}
