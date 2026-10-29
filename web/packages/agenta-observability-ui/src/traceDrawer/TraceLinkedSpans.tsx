import {useMemo} from "react"

import {
    linksAndReferencesAtom,
    setTraceDrawerTraceAtom,
    type TraceDrawerSpanLink,
} from "@agenta/observability/traceDrawer"
import {Tag} from "@agenta/ui/components/presentational"
import {TreeStructureIcon} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

const TraceLinkedSpans = () => {
    const setTraceDrawerTrace = useSetAtom(setTraceDrawerTraceAtom)
    const linksAndReferences = useAtomValue(linksAndReferencesAtom)

    const handleNavigate = (link: TraceDrawerSpanLink) => {
        if (!link?.trace_id || !link?.span_id) return

        setTraceDrawerTrace({
            traceId: link.trace_id,
            activeSpanId: link.span_id,
            source: "linked",
        })
    }

    const validLinks = useMemo(() => {
        const unique = new Map<string, TraceDrawerSpanLink>()

        ;(linksAndReferences?.links || []).forEach((link) => {
            if (!link?.trace_id || !link?.span_id) return
            const id = `${link.trace_id}-${link.span_id}`
            if (unique.has(id)) return
            unique.set(id, link as TraceDrawerSpanLink)
        })

        return Array.from(unique.values())
    }, [linksAndReferences?.links])

    if (!validLinks.length) {
        return <span className="text-colorTextSecondary">No linked spans found.</span>
    }

    return (
        <section className="flex flex-col gap-2">
            {validLinks.length ? (
                <div className="flex flex-col gap-2">
                    {validLinks.map((link) => {
                        return (
                            <Tag
                                key={`${link.trace_id}-${link.span_id}-${link.key || ""}`}
                                className="cursor-pointer self-start bg-[var(--ag-c-0517290F)] flex gap-1 items-center"
                                onClick={() => handleNavigate(link)}
                                icon={<TreeStructureIcon size={14} />}
                                // `trace` is not declared on the link type; the read is kept
                                // (it falls through to `key`) but no longer switches off checking.
                                label={
                                    (link as {trace?: {span_name?: string}[]})?.trace?.[0]
                                        ?.span_name || link?.key
                                }
                            />
                        )
                    })}
                </div>
            ) : null}
        </section>
    )
}

export default TraceLinkedSpans
