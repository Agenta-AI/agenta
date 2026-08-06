import {atom} from "jotai"

/**
 * One-shot "the browser has had a spare (idle) moment since load" flag.
 *
 * Gate NON-critical bootstrap queries (entitlements, billing, permission catalogs) on this so they
 * don't fire in the same burst as the first-paint-critical requests — on a capacity-limited backend
 * a flood of concurrent requests on load saturates the workers and slows the critical ones. Flips
 * true on the first `requestIdleCallback` (or within ~2s via its timeout, whichever comes first),
 * then stays true for the session, so it defers the FIRST load without re-deferring on every read.
 *
 * SSR-safe: resolves immediately when there is no `window` (deferral is a client-only concern).
 */
const idleReadyStateAtom = atom(false)

idleReadyStateAtom.onMount = (set) => {
    if (typeof window === "undefined") {
        set(true)
        return
    }
    const w = window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: {timeout: number}) => number
        cancelIdleCallback?: (handle: number) => void
    }
    if (typeof w.requestIdleCallback === "function") {
        const handle = w.requestIdleCallback(() => set(true), {timeout: 2000})
        return () => w.cancelIdleCallback?.(handle)
    }
    // Safari (no rIC): fall back to a short timeout.
    const timer = window.setTimeout(() => set(true), 1500)
    return () => window.clearTimeout(timer)
}

export const idleReadyAtom = atom((get) => get(idleReadyStateAtom))
