import {useEffect, useRef, type MutableRefObject} from "react"

import {useViewStack, type ViewStack} from "@agenta/ui/view-stack"
import {useRouter} from "next/router"

/** What the page holds of the guarded stack: the stack, and a pass for its own next navigation. */
export interface PageViewStackGuardApi {
    stack: ViewStack
    /** The page's own next navigation (a tab switch it already asked about) goes through. */
    allowNext: () => void
}

/**
 * Keeps an open view form on the page from being lost. Any navigation while a form has edits,
 * Back and Forward included, asks first with the stack's own unsaved-changes dialog. On "Keep
 * editing" after Back or Forward, the browser goes back to this page's history entry. The page
 * asks before its own tab switch, then passes it with `allowNext`.
 */
export const PageViewStackGuard = ({
    guardRef,
}: {
    guardRef: MutableRefObject<PageViewStackGuardApi | null>
}) => {
    const stack = useViewStack()
    const router = useRouter()
    const bypass = useRef(false)
    useEffect(() => {
        const api: PageViewStackGuardApi = {
            stack,
            allowNext: () => {
                bypass.current = true
            },
        }
        guardRef.current = api
        return () => {
            if (guardRef.current === api) guardRef.current = null
        }
    }, [guardRef, stack])
    // The pass is for one navigation: the end of every route change clears it.
    useEffect(() => {
        const clear = () => {
            bypass.current = false
        }
        router.events.on("routeChangeComplete", clear)
        router.events.on("routeChangeError", clear)
        return () => {
            router.events.off("routeChangeComplete", clear)
            router.events.off("routeChangeError", clear)
        }
    }, [router])
    useEffect(() => {
        if (!stack.dirty) return
        const onRouteChangeStart = (url: string, {shallow}: {shallow: boolean}) => {
            if (bypass.current) {
                bypass.current = false
                return
            }
            // Back and Forward have moved the browser already; a link click has not.
            const historyMove =
                url.split("#")[0] === window.location.pathname + window.location.search
            void stack.closeAll().then((left) => {
                bypass.current = true
                if (left) {
                    const go = historyMove ? router.replace : router.push
                    void go(url, undefined, {shallow}).catch(() => undefined)
                } else if (historyMove) {
                    // Back to this page's entry: the form stays, at its own address.
                    window.history.forward()
                } else {
                    bypass.current = false
                }
            })
            router.events.emit("routeChangeError")
            // The Next.js idiom for cancelling a navigation; nothing catches it.
            throw "Route change aborted: an open view form has edits"
        }
        router.events.on("routeChangeStart", onRouteChangeStart)
        return () => router.events.off("routeChangeStart", onRouteChangeStart)
    }, [router, stack])
    return null
}
