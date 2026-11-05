import {useEffect, useRef} from "react"

import {openTraceDrawerAtom, traceDrawerAtom} from "@agenta/observability/traceDrawer"
import {useAtomValue, useSetAtom} from "jotai"
import type {NextRouter} from "next/router"

const param = (value: string | string[] | undefined) =>
    typeof value === "string" && value !== "" ? value : null

/**
 * Opens the trace drawer on the trace the address names, so a reload or a shared link shows the
 * same trace and span. It acts when `?trace` changes, not on every render: a drawer the user
 * closed stays closed while its params leave the address.
 */
export const useTraceDrawerFromUrl = (router: NextRouter) => {
    const drawer = useAtomValue(traceDrawerAtom)
    const openTrace = useSetAtom(openTraceDrawerAtom)
    const handled = useRef<string | null>(null)
    const traceId = router.isReady ? param(router.query.trace) : null
    const spanId = param(router.query.span)

    useEffect(() => {
        if (!traceId) {
            handled.current = null
            return
        }
        if (handled.current === traceId) return
        handled.current = traceId
        if (drawer.open && drawer.traceId === traceId) return
        openTrace({traceId, activeSpanId: spanId})
    }, [traceId, spanId, drawer.open, drawer.traceId, openTrace])
}
