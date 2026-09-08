import {useCallback, useEffect, useRef} from "react"

import {useRouter} from "next/router"

interface ConfirmRequest {
    title: string
    message: string
    onOk: () => void | Promise<void>
}

/**
 * Stops a route change while there are unsaved edits, asks, and then lets it through.
 *
 * The Pages Router has no navigation blocker, so the documented way out is to abort
 * `routeChangeStart` by throwing — the throw IS the abort, and `routeChangeError` is what puts
 * the progress bar back. The confirmation is the app's own `ConfirmSheet`, not a browser dialog, so
 * leaving an automation reads like every other confirm on this surface.
 *
 * The retry sets a bypass flag rather than unbinding the listener: the effect is keyed on `dirty`,
 * which has not changed by then. `leave` is that same bypass, for the navigations that are not a
 * question — after a delete there is no longer anything to save.
 */
export const useUnsavedGuard = ({
    dirty,
    confirm,
}: {
    dirty: boolean
    confirm: (request: ConfirmRequest) => void
}) => {
    const router = useRouter()
    const bypass = useRef(false)

    useEffect(() => {
        if (!dirty) return

        const onRouteChangeStart = (url: string) => {
            if (bypass.current) {
                bypass.current = false
                return
            }
            confirm({
                title: "Leave without saving?",
                message: "This automation has changes you haven't saved. Leaving discards them.",
                onOk: () => {
                    bypass.current = true
                    void router.push(url).catch(() => undefined)
                },
            })
            router.events.emit("routeChangeError")
            // The Next.js idiom for cancelling a navigation; nothing catches it.
            throw "Route change aborted — this automation has unsaved changes"
        }

        router.events.on("routeChangeStart", onRouteChangeStart)
        return () => router.events.off("routeChangeStart", onRouteChangeStart)
    }, [confirm, dirty, router])

    return useCallback(
        (url: string) => {
            bypass.current = true
            // An aborted route change rejects the push; nothing here has anything to add to it.
            void router.push(url).catch(() => undefined)
        },
        [router],
    )
}
