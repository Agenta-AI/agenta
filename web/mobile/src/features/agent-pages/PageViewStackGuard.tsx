import {useEffect, useRef, type MutableRefObject} from "react"

import {useViewStack, type ViewStack} from "@agenta/ui/view-stack"
import {useRouter} from "next/router"

/**
 * Keeps an open view form on the page from being lost. A route change away from the page asks
 * first with the stack's own unsaved-changes dialog, then goes on. The page reads the stack from
 * `stackRef` to ask the same before it switches tab.
 */
export const PageViewStackGuard = ({stackRef}: {stackRef: MutableRefObject<ViewStack | null>}) => {
    const stack = useViewStack()
    const router = useRouter()
    const bypass = useRef(false)
    useEffect(() => {
        stackRef.current = stack
        return () => {
            if (stackRef.current === stack) stackRef.current = null
        }
    }, [stack, stackRef])
    // The bypass is for one navigation: the end of every route change clears it, also when the
    // form was left clean and no listener consumed it.
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
            // A shallow change stays on this page; the tab switch asks on its own.
            if (shallow) return
            if (bypass.current) {
                bypass.current = false
                return
            }
            void stack.closeAll().then((left) => {
                if (!left) return
                bypass.current = true
                void router.push(url).catch(() => undefined)
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
