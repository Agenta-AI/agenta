import {useEffect, useRef} from "react"

import {
    closeTraceDrawerAtom,
    openTraceDrawerAtom,
    setTraceDrawerActiveSpanAtom,
    traceDrawerAtom,
} from "@agenta/observability/traceDrawer"
import {useSetAtom, useStore} from "jotai"
import type {NextRouter} from "next/router"

const param = (value: string | string[] | undefined) =>
    typeof value === "string" && value !== "" ? value : null

/**
 * Keeps the trace drawer and the address in step, for a reload, a shared link and Back/Forward:
 *
 * - `?trace` appears or changes: open the drawer on it (and on `?span`).
 * - `?trace` leaves while the drawer shows that trace (Back past it): close the drawer.
 * - `?span` changes on the same trace (Back to the span before): show that span.
 *
 * It acts on address changes only, so a drawer the user closed stays closed while its params
 * leave the address, and the drawer's own span clicks are not undone.
 */
export const useTraceDrawerFromUrl = (router: NextRouter) => {
    const store = useStore()
    const openTrace = useSetAtom(openTraceDrawerAtom)
    const closeTrace = useSetAtom(closeTraceDrawerAtom)
    const setSpan = useSetAtom(setTraceDrawerActiveSpanAtom)
    const handled = useRef<string | null>(null)
    const traceId = router.isReady ? param(router.query.trace) : null
    const spanId = param(router.query.span)
    // Read when `?trace` changes; a change of `?span` alone is the second effect's job.
    const spanRef = useRef(spanId)
    spanRef.current = spanId

    useEffect(() => {
        const drawer = store.get(traceDrawerAtom)
        if (!traceId) {
            // Back past the trace: the address no longer names the trace the drawer shows.
            if (handled.current && drawer.open && drawer.traceId === handled.current) closeTrace()
            handled.current = null
            return
        }
        if (handled.current === traceId) return
        handled.current = traceId
        if (drawer.open && drawer.traceId === traceId) return
        openTrace({traceId, activeSpanId: spanRef.current})
    }, [traceId, openTrace, closeTrace, store])

    // The span the address named last, with its trace: Back to another span of the same trace
    // moves the drawer; a span that comes with a new trace is the first effect's job.
    const lastSeen = useRef({traceId, spanId})
    useEffect(() => {
        const previous = lastSeen.current
        lastSeen.current = {traceId, spanId}
        if (!spanId || traceId !== previous.traceId || spanId === previous.spanId) return
        const drawer = store.get(traceDrawerAtom)
        if (!drawer.open || drawer.traceId !== traceId) return
        // The drawer's own span clicks write the address after its state: they match already.
        if (drawer.activeSpanId !== spanId) setSpan(spanId)
    }, [spanId, traceId, setSpan, store])
}
