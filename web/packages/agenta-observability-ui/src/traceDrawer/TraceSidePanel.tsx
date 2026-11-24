import {useMemo} from "react"

import {useT} from "@agenta/i18n"
import drawerCatalog from "@agenta/i18n/catalogs/observabilityUi.traceDrawer"
import type {TraceSpanNode} from "@agenta/observability"
import type {TracesWithAnnotations} from "@agenta/observability/dto"
import {useTraceDrawer} from "@agenta/observability/traceDrawer"
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
    SkeletonBlock,
} from "@agenta/ui/ui"

import TraceAnnotations from "./TraceAnnotations"
import TraceDetails from "./TraceDetails"
import TraceLinkedSpans from "./TraceLinkedSpans"
import TraceReferences from "./TraceReferences"

const collapseItemLabelClass = "text-label"

const TraceSidePanel = ({
    activeTrace,
    activeTraceId,
    isLoading = false,
}: {
    activeTrace?: TracesWithAnnotations
    activeTraceId?: string
    isLoading?: boolean
}) => {
    const t = useT(drawerCatalog)
    const {getTraceById} = useTraceDrawer()
    const derived = activeTrace || getTraceById(activeTraceId)

    const showLoading = isLoading && !derived

    const loadingContent = (
        <div className="px-3 py-4">
            <div className="flex flex-col gap-2">
                {/* antd `Skeleton paragraph={{rows: 4}}` */}
                {[0, 1, 2, 3].map((row) => (
                    <SkeletonBlock key={row} className="max-w-[160px]" />
                ))}
            </div>
        </div>
    )

    const emptyState = (message: string) => (
        <div className="px-3 py-4">
            <span className="text-muted-foreground text-body">{message}</span>
        </div>
    )

    const annotationsContent = showLoading ? (
        loadingContent
    ) : derived ? (
        <TraceAnnotations annotations={derived?.annotations || []} />
    ) : (
        emptyState(t("observabilityUi.traceDrawer.selectSpanAnnotations"))
    )

    const detailsContent = showLoading ? (
        loadingContent
    ) : derived ? (
        <TraceDetails activeTrace={derived as TraceSpanNode} />
    ) : (
        emptyState(t("observabilityUi.traceDrawer.selectSpanDetails"))
    )

    const linkedContent = showLoading ? (
        loadingContent
    ) : derived ? (
        <TraceLinkedSpans />
    ) : (
        emptyState(t("observabilityUi.traceDrawer.noLinkedSpans"))
    )

    const referencesContent = showLoading ? (
        loadingContent
    ) : derived ? (
        <TraceReferences />
    ) : (
        emptyState(t("observabilityUi.traceDrawer.noReferences"))
    )

    const items = useMemo(
        () => [
            {
                key: "annotations",
                label: (
                    <span className={collapseItemLabelClass}>
                        {t("observabilityUi.traceDrawer.tabAnnotations")}
                    </span>
                ),
                children: annotationsContent,
            },
            {
                key: "details",
                label: (
                    <span className={collapseItemLabelClass}>
                        {t("observabilityUi.traceDrawer.traceInfo")}
                    </span>
                ),
                children: detailsContent,
            },
            {
                key: "references",
                label: (
                    <span className={collapseItemLabelClass}>
                        {t("observabilityUi.traceDrawer.references")}
                    </span>
                ),
                children: referencesContent,
            },
            {
                key: "linked",
                label: (
                    <span className={collapseItemLabelClass}>
                        {t("observabilityUi.traceDrawer.linkedSpansSection")}
                    </span>
                ),
                children: linkedContent,
            },
        ],
        [activeTrace, derived, t],
    )

    return (
        <Accordion
            type="multiple"
            defaultValue={["annotations", "details", "references", "linked"]}
            className="transition-all duration-300 ease-[ease] max-w-full overflow-hidden opacity-100 rounded-none border-0"
        >
            {items.map((item) => (
                <AccordionItem key={item.key} value={item.key} className="border-border-muted">
                    {/* Section headers on the row scale: row-single (ROW-01). */}
                    <AccordionTrigger className="box-border h-row-single !items-center !py-0">
                        {item.label}
                    </AccordionTrigger>
                    <AccordionContent className="p-3 border-border-muted">
                        {item.children}
                    </AccordionContent>
                </AccordionItem>
            ))}
        </Accordion>
    )
}

export default TraceSidePanel
