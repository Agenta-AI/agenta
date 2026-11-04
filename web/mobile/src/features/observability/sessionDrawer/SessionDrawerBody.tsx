import {useEffect, useMemo, useRef, useState} from "react"

import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {LoadError} from "@agenta/ui/components/presentational"
import {useAtomValue, useSetAtom} from "jotai"

import {
    observabilitySessionAnnotatedTracesAtomFamily,
    observabilitySessionStatsAtomFamily,
    observabilitySessionTracesAtomFamily,
    observabilitySessionTracesQueryAtomFamily,
} from "./sessionDrawerQueries"
import {SessionTurnList} from "./SessionTurnList"
import {
    findSpanInSession,
    SESSION_TREE_ROOT_KEY,
    sessionTraceAnchorId,
    sortTracesByStart,
} from "./sessionTurns"
import {SessionTurnsTree} from "./SessionTurnsTree"
import {SessionDrawerEmpty} from "./states/SessionDrawerEmpty"
import {SessionDrawerSkeleton} from "./states/SessionDrawerSkeleton"

const scrollToTrace = (spanId: string) =>
    document
        .getElementById(sessionTraceAnchorId(spanId))
        ?.scrollIntoView({behavior: "smooth", block: "start"})

interface SessionDrawerBodyProps {
    sessionId: string
    /** The `?span=` the address bar had when the session opened. Later values are ignored. */
    linkedSpanId: string | null
    /** A phone-width panel shows the traces only: "View trace" reaches the spans. */
    narrow: boolean
    /** The annotations sit beside the messages, not under them. */
    annotationsBeside: boolean
}

/** Loads one session and picks what shows: loading, error, no traces, or the tree and panels. */
export const SessionDrawerBody = ({
    sessionId,
    linkedSpanId,
    narrow,
    annotationsBeside,
}: SessionDrawerBodyProps) => {
    // The trace drawer writes `?span=` too, as its own span. Read it once, as the link's.
    const [initialSpanId] = useState(linkedSpanId)
    const query = useAtomValue(observabilitySessionTracesQueryAtomFamily(sessionId))
    const {truncated} = useAtomValue(observabilitySessionTracesAtomFamily(sessionId))
    const annotated = useAtomValue(observabilitySessionAnnotatedTracesAtomFamily(sessionId))
    const stats = useAtomValue(observabilitySessionStatsAtomFamily(sessionId))
    const openTraceDrawer = useSetAtom(openTraceDrawerAtom)

    const traces = useMemo(() => sortTracesByStart(annotated), [annotated])
    const linked = useMemo(
        () => (initialSpanId ? findSpanInSession(traces, initialSpanId) : null),
        [traces, initialSpanId],
    )
    const [picked, setPicked] = useState<string | null>(null)
    const selectedKey = picked ?? (linked?.kind === "trace" ? linked.spanId : SESSION_TREE_ROOT_KEY)

    // A link with `?span=` lands once: on a trace it scrolls there, on a span inside a trace it
    // opens the trace drawer. A later `?span=` is the trace drawer's own and must not reopen it.
    const linkHandled = useRef(false)
    useEffect(() => {
        if (linkHandled.current || !linked) return
        linkHandled.current = true
        if (linked.kind === "trace") scrollToTrace(linked.spanId)
        else openTraceDrawer({traceId: linked.traceId, activeSpanId: linked.spanId})
    }, [linked, openTraceDrawer])

    const select = (key: string) => {
        setPicked(key)
        if (key === SESSION_TREE_ROOT_KEY) return
        const target = findSpanInSession(traces, key)
        if (target?.kind === "trace") scrollToTrace(target.spanId)
        else if (target?.kind === "span")
            openTraceDrawer({traceId: target.traceId, activeSpanId: target.spanId})
    }

    if (query.isPending) return <SessionDrawerSkeleton narrow={narrow} />
    if (query.isError)
        return (
            <LoadError title="Could not load this session" onRetry={() => void query.refetch()} />
        )
    if (traces.length === 0) return <SessionDrawerEmpty />

    return (
        <div className="flex min-h-0 flex-1">
            {narrow ? null : (
                <div className="w-[320px] shrink-0 border-0 border-r border-solid border-border">
                    <SessionTurnsTree
                        traces={traces}
                        stats={stats}
                        selectedKey={selectedKey}
                        onSelect={select}
                    />
                </div>
            )}
            <SessionTurnList
                traces={traces}
                stats={stats}
                truncated={truncated}
                annotationsBeside={annotationsBeside}
            />
        </div>
    )
}
