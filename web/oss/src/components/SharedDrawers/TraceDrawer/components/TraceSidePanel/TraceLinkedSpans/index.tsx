import {useMemo} from "react"

import {Badge} from "@agenta/primitive-ui/components/badge"
import {TreeStructureIcon} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {
    linksAndReferencesAtom,
    setTraceDrawerTraceAtom,
    TraceDrawerSpanLink,
} from "@/oss/components/SharedDrawers/TraceDrawer/store/traceDrawerStore"

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
        return <span className="text-muted-foreground">No linked spans found.</span>
    }

    return (
        <section className="flex flex-col gap-2">
            {validLinks.length ? (
                <div className="flex flex-col gap-2">
                    {validLinks.map((link) => {
                        return (
                            <Badge
                                key={`${link.trace_id}-${link.span_id}-${link.key || ""}`}
                                className="cursor-pointer self-start bg-[var(--ag-c-0517290F)] flex gap-1 items-center"
                                onClick={() => handleNavigate(link)}
                                variant="secondary"
                            >
                                <TreeStructureIcon size={14} />{" "}
                                {link?.trace?.[0]?.span_name || link?.key}
                            </Badge>
                        )
                    })}
                </div>
            ) : null}
        </section>
    )
}

export default TraceLinkedSpans
