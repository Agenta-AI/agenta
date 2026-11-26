import {useEffect, useRef} from "react"

import {
    closeTraceDrawerAtom,
    openTraceDrawerAtom,
    setTraceDrawerActiveSpanAtom,
    traceDrawerAtom,
    traceDrawerResolvedActiveSpanIdAtom,
} from "@agenta/observability/traceDrawer"
import {useSetAtom, useStore} from "jotai"
import type {NextRouter} from "next/router"

import {replaceNextTraceDrawerSpanWrite} from "./bindTraceDrawerSeams"

const param = (value: string | string[] | undefined) =>
    typeof value === "string" && value !== "" ? value : null

/**
 * Keeps the trace drawer and the address in step, for a reload, a shared link and Back/Forward:
 *
 * - `?trace` appears or changes: open the drawer on it (and on `?span`).
 * - `?trace` leaves while the drawer shows that trace (Back past it): close the drawer.
 * - `?span` changes on the same trace (Back to the span before): show that span, or none when
 *   the address names no span.
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
        if (!traceId || traceId !== previous.traceId || spanId === previous.spanId) return
        const drawer = store.get(traceDrawerAtom)
        if (!drawer.open || drawer.traceId !== traceId) return
        // The drawer's own span clicks write the address after its state: they match already.
        // Back to an address with no span clears the selected one.
        if (drawer.activeSpanId === spanId) return
        const shown = store.get(traceDrawerResolvedActiveSpanIdAtom)
        setSpan(spanId)
        // With no span the drawer falls back to its first one and writes it to the address. That
        // write must not push an entry over the one Back went to. When the drawer already showed
        // its first span, nothing is written, and the next pick must push as usual.
        if (!spanId && store.get(traceDrawerResolvedActiveSpanIdAtom) !== shown) {
            replaceNextTraceDrawerSpanWrite()
        }
    }, [spanId, traceId, setSpan, store])
}
