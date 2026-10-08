import {useEffect} from "react"

import {useRouter} from "next/router"

import {routeHoldMs} from "./presets"

interface PendingTransition {
    done: boolean
    resolve?: () => void
}

const pathOf = (url: string) => new URL(url, window.location.href).pathname

/** Crossfades the `ag-screen-transition` pane on path changes via native View Transitions. */
export function useRouteTransition(): void {
    const router = useRouter()

    useEffect(() => {
        if (typeof document.startViewTransition !== "function") return
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
        const root = document.documentElement
        let pending: PendingTransition | null = null
        let latest: ViewTransition | null = null

        const settle = () => {
            if (!pending) return
            pending.done = true
            pending.resolve?.()
            pending = null
        }

        const onStart = (url: string, {shallow}: {shallow: boolean}) => {
            if (shallow || reducedMotion.matches) return
            if (pathOf(url) === window.location.pathname) return
            settle()
            const entry: PendingTransition = {done: false}
            pending = entry
            // Names the screen pane for this transition only (motion.css).
            root.dataset.routeTransition = ""
            // The browser shows the old screen until this resolves: on commit, or after the hold.
            const transition = document.startViewTransition(() => {
                if (entry.done) return
                return new Promise<void>((resolve) => {
                    const timer = window.setTimeout(resolve, routeHoldMs)
                    entry.resolve = () => {
                        window.clearTimeout(timer)
                        resolve()
                    }
                })
            })
            // A skipped transition (a newer navigation, a hidden tab) rejects `ready`; that is fine.
            transition.ready.catch(() => undefined)
            latest = transition
            transition.finished.finally(() => {
                if (latest === transition) delete root.dataset.routeTransition
            })
        }

        router.events.on("routeChangeStart", onStart)
        router.events.on("routeChangeComplete", settle)
        router.events.on("routeChangeError", settle)
        return () => {
            router.events.off("routeChangeStart", onStart)
            router.events.off("routeChangeComplete", settle)
            router.events.off("routeChangeError", settle)
            settle()
        }
    }, [router.events])
}
