import {useMemo} from "react"

import type {TraceSpanNode} from "@agenta/observability"
import type {TracesWithAnnotations} from "@agenta/observability/dto"
import {useTraceDrawer} from "@agenta/observability/traceDrawer"
import {Accordion, AccordionContent, AccordionItem, AccordionTrigger} from "@agenta/ui/ui"

import {SkeletonBlock} from "../primitives/SkeletonBlock"

import TraceAnnotations from "./TraceAnnotations"
import TraceDetails from "./TraceDetails"
import TraceLinkedSpans from "./TraceLinkedSpans"
import TraceReferences from "./TraceReferences"

const collapseItemLabelClass = "text-xs font-medium leading-[1.6666666666666667]"

const TraceSidePanel = ({
    activeTrace,
    activeTraceId,
    isLoading = false,
}: {
    activeTrace?: TracesWithAnnotations
    activeTraceId?: string
    isLoading?: boolean
}) => {
    const {getTraceById} = useTraceDrawer()
    const derived = activeTrace || getTraceById(activeTraceId)

    const showLoading = isLoading && !derived

    const loadingContent = (
        <div className="px-3 py-4">
            <div className="flex flex-col gap-2">
                {/* antd `Skeleton paragraph={{rows: 4}}` */}
                {[0, 1, 2, 3].map((row) => (
                    <SkeletonBlock key={row} />
                ))}
            </div>
        </div>
    )

    const emptyState = (message: string) => (
        <div className="px-3 py-4">
            <span className="text-colorTextSecondary text-sm">{message}</span>
        </div>
    )

    const annotationsContent = showLoading ? (
        loadingContent
    ) : derived ? (
        <TraceAnnotations annotations={derived?.annotations || []} />
    ) : (
        emptyState("Select a span to view annotations.")
    )

    const detailsContent = showLoading ? (
        loadingContent
    ) : derived ? (
        <TraceDetails activeTrace={derived as TraceSpanNode} />
    ) : (
        emptyState("Select a span to view trace details.")
    )

    const linkedContent = showLoading ? (
        loadingContent
    ) : derived ? (
        <TraceLinkedSpans />
    ) : (
        emptyState("No linked spans found.")
    )

    const referencesContent = showLoading ? (
        loadingContent
    ) : derived ? (
        <TraceReferences />
    ) : (
        emptyState("No references found.")
    )

    const items = useMemo(
        () => [
            {
                key: "annotations",
                label: <span className={collapseItemLabelClass}>Annotations</span>,
                children: annotationsContent,
            },
            {
                key: "details",
                label: <span className={collapseItemLabelClass}>Trace info</span>,
                children: detailsContent,
            },
            {
                key: "references",
                label: <span className={collapseItemLabelClass}>References</span>,
                children: referencesContent,
            },
            {
                key: "linked",
                label: <span className={collapseItemLabelClass}>Linked spans</span>,
                children: linkedContent,
            },
        ],
        [activeTrace, derived],
    )

    return (
        <Accordion
            type="multiple"
            defaultValue={["annotations", "details", "references", "linked"]}
            className="transition-all duration-300 ease-[ease] max-w-full overflow-hidden opacity-100 rounded-none border-0"
        >
            {items.map((item) => (
                <AccordionItem
                    key={item.key}
                    value={item.key}
                    className="border-[var(--ag-colorSplit)]"
                >
                    {/* antd's header padding was 10.5px; the panel body was 12px. */}
                    <AccordionTrigger className="!py-[10.5px]">{item.label}</AccordionTrigger>
                    <AccordionContent className="p-3 border-[var(--ag-colorSplit)]">
                        {item.children}
                    </AccordionContent>
                </AccordionItem>
            ))}
        </Accordion>
    )
}

export default TraceSidePanel
