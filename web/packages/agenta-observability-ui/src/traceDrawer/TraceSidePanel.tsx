import {useMemo} from "react"

import {useT} from "@agenta/i18n"
import drawerCatalog from "@agenta/i18n/catalogs/observabilityUi.traceDrawer"
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
    const t = useT(drawerCatalog)
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
