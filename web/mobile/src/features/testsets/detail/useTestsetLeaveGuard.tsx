import {useCallback, useEffect, useRef, useState} from "react"

import {useRouter} from "next/router"

import {LeavePrompt} from "./LeavePrompt"

/**
 * Stops a route change or a tab close while the test set has unsaved changes.
 *
 * The Pages Router has no navigation blocker, so a route change is stopped the way
 * `useUnsavedGuard` stops it: throw from `routeChangeStart`. The prompt then offers three ways
 * out. "Save" calls `onSave` (the commit step) and keeps the page, so the changes are not lost
 * (the old app also left the page). "Discard changes" calls `onDiscard` and goes on.
 *
 * `leave(url)` goes to a page with no prompt, for the moves that are not a question: after a
 * commit or an archive there is nothing left to save. Render `prompt` once on the page.
 */
export function useTestsetLeaveGuard({
    dirty,
    isNew,
    onSave,
    onDiscard,
}: {
    dirty: boolean
    isNew: boolean
    onSave: () => void
    onDiscard: () => void
}) {
    const router = useRouter()
    const bypass = useRef(false)
    const [target, setTarget] = useState<string | null>(null)

    useEffect(() => {
        if (!dirty) return

        const onRouteChangeStart = (url: string) => {
            if (bypass.current) {
                bypass.current = false
                return
            }
            setTarget(url)
            router.events.emit("routeChangeError")
            // The Next.js idiom for cancelling a navigation; nothing catches it.
            throw "Route change aborted — this test set has unsaved changes"
        }
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault()
            event.returnValue = ""
        }

        router.events.on("routeChangeStart", onRouteChangeStart)
        window.addEventListener("beforeunload", onBeforeUnload)
        return () => {
            router.events.off("routeChangeStart", onRouteChangeStart)
            window.removeEventListener("beforeunload", onBeforeUnload)
        }
    }, [dirty, router])

    const leave = useCallback(
        (url: string) => {
            bypass.current = true
            // An aborted route change rejects the push; nothing here has anything to add to it.
            void router
                .push(url)
                .catch(() => undefined)
                // A push to the page already open fires no route change; the flag must not wait.
                .finally(() => {
                    bypass.current = false
                })
        },
        [router],
    )

    const prompt = (
        <LeavePrompt
            open={target !== null}
            isNew={isNew}
            onCancel={() => setTarget(null)}
            onSave={() => {
                setTarget(null)
                onSave()
            }}
            onLeave={() => {
                const url = target
                setTarget(null)
                onDiscard()
                if (url) leave(url)
            }}
        />
    )

    return {leave, prompt}
}
