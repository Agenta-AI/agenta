import {useMemo} from "react"

import {useT} from "@agenta/i18n"
import drawerCatalog from "@agenta/i18n/catalogs/observabilityUi.traceDrawer"
import {
    linksAndReferencesAtom,
    setTraceDrawerTraceAtom,
    type TraceDrawerSpanLink,
} from "@agenta/observability/traceDrawer"
import {Tag} from "@agenta/ui/components/presentational"
import {TreeStructureIcon} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

const TraceLinkedSpans = () => {
    const t = useT(drawerCatalog)
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

    // A span with no links has no Linked spans section.
    if (!validLinks.length) return null

    return (
        <section className="flex flex-col gap-2" data-testid="trace-linked-spans">
            <h3 className="m-0 text-label">
                {t("observabilityUi.traceDrawer.linkedSpansSection")}
            </h3>
            <div className="flex flex-col gap-2">
                {validLinks.map((link) => (
                    <Tag
                        key={`${link.trace_id}-${link.span_id}-${link.key || ""}`}
                        className="cursor-pointer self-start bg-secondary flex gap-1 items-center"
                        onClick={() => handleNavigate(link)}
                        icon={<TreeStructureIcon size={14} />}
                        // `trace` is not declared on the link type. A link with no name and
                        // no key (an OpenTelemetry link to another trace) shows its span id.
                        label={
                            (link as {trace?: {span_name?: string}[]})?.trace?.[0]?.span_name ||
                            link?.key ||
                            link.span_id
                        }
                    />
                ))}
            </div>
        </section>
    )
}

export default TraceLinkedSpans
