import {useMemo} from "react"

import {Collapse, CollapseProps, Skeleton, Typography} from "antd"
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
            <Skeleton active paragraph={{rows: 4}} title={false} />
        </div>
    )

    const emptyState = (message: string) => (
        <div className="px-3 py-4">
            <Typography.Text type="secondary" className="text-sm">
                {message}
            </Typography.Text>
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

    const items: CollapseProps["items"] = useMemo(
        () => [
            {
                key: "annotations",
                label: (
                    <Typography.Text className={collapseItemLabelClass}>
                        Annotations
                    </Typography.Text>
                ),
                children: annotationsContent,
            },
            {
                key: "details",
                label: (
                    <Typography.Text className={collapseItemLabelClass}>Trace info</Typography.Text>
                ),
                children: detailsContent,
            },
            {
                key: "references",
                label: (
                    <Typography.Text className={collapseItemLabelClass}>References</Typography.Text>
                ),
                children: referencesContent,
            },
            {
                key: "linked",
                label: (
                    <Typography.Text className={collapseItemLabelClass}>
                        Linked spans
                    </Typography.Text>
                ),
                children: linkedContent,
            },
        ],
        [activeTrace, derived],
    )

    return (
        <Collapse
            items={items}
            defaultActiveKey={["annotations", "details", "linked", "references"]}
            className={clsx(
                "transition-all duration-300 ease-[ease] max-w-full overflow-hidden opacity-100 rounded-none border-0",
                "[&_.ant-collapse-content]:border-[var(--ag-colorSplit)] [&_.ant-collapse-content_.ant-collapse-content-box]:p-3 [&_.ant-collapse-item]:border-[var(--ag-colorSplit)]",
                "[&_.ant-collapse-header]:!py-[10.5px]",
            )}
        />
    )
}

export default TraceSidePanel
