import {useMemo} from "react"

import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@agenta/primitive-ui/components/accordion"
import {Skeleton} from "@agenta/primitive-ui/components/skeleton"
import clsx from "clsx"

import {TracesWithAnnotations} from "@/oss/services/observability/types"

import useTraceDrawer from "../../hooks/useTraceDrawer"

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
            <div className="flex w-full flex-col gap-3">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/5" />
            </div>
        </div>
    )

    const emptyState = (message: string) => (
        <div className="px-3 py-4">
            <span className="text-sm text-muted-foreground">{message}</span>
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
        <TraceDetails activeTrace={derived as any} />
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
            defaultValue={["annotations", "details", "linked", "references"]}
            className={clsx(
                "transition-all duration-300 ease-[ease] max-w-full overflow-hidden opacity-100 rounded-none border-0",
                "[&_[data-slot=accordion-content]]:border-[var(--ag-colorSplit)] [&_[data-slot=accordion-content]>div]:p-3 [&_[data-slot=accordion-item]]:border-[var(--ag-colorSplit)]",
                "[&_[data-slot=accordion-trigger]]:!py-[10.5px]",
            )}
        >
            {items.map((item) => (
                <AccordionItem key={item.key} value={item.key}>
                    <AccordionTrigger>{item.label}</AccordionTrigger>
                    <AccordionContent keepMounted>{item.children}</AccordionContent>
                </AccordionItem>
            ))}
        </Accordion>
    )
}

export default TraceSidePanel
