import {useMemo} from "react"

import {TreeStructureIcon} from "@phosphor-icons/react"
import {Tag, Typography} from "antd"
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
        return <Typography.Text type="secondary">No linked spans found.</Typography.Text>
    }

    return (
        <section className="flex flex-col gap-2">
            {validLinks.length ? (
                <div className="flex flex-col gap-2">
                    {validLinks.map((link) => {
                        return (
                            <Tag
                                key={`${link.trace_id}-${link.span_id}-${link.key || ""}`}
                                variant="filled"
                                className="cursor-pointer self-start bg-[#0517290F] flex gap-1 items-center"
                                onClick={() => handleNavigate(link)}
                            >
                                <TreeStructureIcon size={14} />{" "}
                                {link?.trace?.[0]?.span_name || link?.key}
                            </Tag>
                        )
                    })}
                </div>
            ) : null}
        </section>
    )
}

export default TraceLinkedSpans
