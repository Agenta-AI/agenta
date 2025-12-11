import TooltipWithCopyAction from "@/oss/components/TooltipWithCopyAction"
import {Button, Tag, Tooltip, Typography} from "antd"
import {Database} from "lucide-react"
import dynamic from "next/dynamic"
import AnnotateDrawerButton from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/AnnotateDrawerButton"

import clsx from "clsx"

import {KeyValuePair} from "@/oss/lib/Types"
import {spanAgDataAtomFamily} from "@/oss/state/newObservability/selectors/tracing"
import {DeleteOutlined} from "@ant-design/icons"
import {SidebarSimple} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import {useMemo, useState} from "react"

import {getTraceIdFromNode} from "../../../TraceHeader/assets/helper"
import {TraceTypeHeaderProps} from "./types"

const DeleteTraceModal = dynamic(
    () => import("../../../DeleteTraceModal"),
    {
        ssr: false,
    },
)
const TestsetDrawer = dynamic(
    () => import("@/oss/components/pages/observability/drawer/TestsetDrawer/TestsetDrawer"),
    {ssr: false},
)

const TraceTypeHeader = ({
    activeTrace,
    error,
    traces,
    setSelectedTraceId,
    setIsAnnotationsSectionOpen,
    isAnnotationsSectionOpen,
}: TraceTypeHeaderProps) => {
    const [isTestsetDrawerOpen, setIsTestsetDrawerOpen] = useState(false)
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
    const activeTraceData = useAtomValue(spanAgDataAtomFamily(activeTrace))
    const testsetData = useMemo(() => {
        if (!activeTrace?.key) return [] as {data: KeyValuePair; key: string; id: number}[]
        return [
            {
                data: activeTraceData as KeyValuePair,
                key: activeTrace.key,
                id: 1,
            },
        ]
    }, [activeTrace?.key, activeTraceData])

    const displayTrace = activeTrace || traces?.[0]

    return (
        <div className="h-10 px-4 flex items-center justify-between gap-2 border-0 border-b border-solid border-colorSplit">
            <Tooltip
                placement="topLeft"
                title={activeTrace?.span_name || (error ? "Error" : "")}
                mouseEnterDelay={0.25}
            >
                <Typography.Text
                    className={clsx("truncate text-nowrap flex-1 text-sm font-medium")}
                >
                    {activeTrace?.span_name || (error ? "Error" : "")}
                </Typography.Text>
            </Tooltip>

            <div className="flex gap-2">
                <TooltipWithCopyAction
                    copyText={activeTrace?.span_id || ""}
                    title="Copy span id"
                    tooltipProps={{placement: "bottom", arrow: true}}
                >
                    <Tag className="font-mono truncate bg-[#0517290F]" bordered={false}>
                        # {activeTrace?.span_id || "-"}
                    </Tag>
                </TooltipWithCopyAction>
                <Button
                    className="flex items-center"
                    onClick={() => setIsTestsetDrawerOpen(true)}
                    disabled={!activeTrace?.key}
                    size="small"
                >
                    <Database size={14} />
                    Add to testset
                </Button>

                <AnnotateDrawerButton
                    label="Annotate"
                    size="small"
                    data={activeTrace?.annotations || []}
                    traceSpanIds={{
                        traceId: activeTrace?.trace_id,
                        spanId: activeTrace?.span_id,
                    }}
                />

                <Button
                    icon={<DeleteOutlined />}
                    onClick={() => setIsDeleteModalOpen(true)}
                    disabled={!displayTrace}
                    size="small"
                />
                {setIsAnnotationsSectionOpen && (
                    <Button
                        icon={<SidebarSimple size={14} />}
                        type={isAnnotationsSectionOpen ? "default" : "primary"}
                        className="shrink-0 flex items-center justify-center"
                        onClick={() => setIsAnnotationsSectionOpen((prev) => !prev)}
                        size="small"
                    />
                )}
            </div>

            <TestsetDrawer
                open={isTestsetDrawerOpen && !!activeTrace?.key}
                data={testsetData}
                onClose={() => setIsTestsetDrawerOpen(false)}
            />
            <DeleteTraceModal
                open={isDeleteModalOpen}
                onCancel={() => setIsDeleteModalOpen(false)}
                activeTraceId={getTraceIdFromNode(displayTrace) || ""}
                setSelectedTraceId={setSelectedTraceId}
            />
        </div>
    )
}

export default TraceTypeHeader
