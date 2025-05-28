import {useEffect, useMemo, useState} from "react"

import {Table, TableColumnType, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import dynamic from "next/dynamic"

import GenericDrawer from "@/oss/components/GenericDrawer"
import ObservabilityContextProvider, {
    useObservabilityData,
} from "@/oss/contexts/observability.context"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {getNodeById} from "@/oss/lib/helpers/observability_helpers"
import useAnnotations from "@/oss/lib/hooks/useAnnotations"
import {groupAnnotationsByReferenceId} from "@/oss/lib/hooks/useAnnotations/assets/helpers"
import {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import {_AgentaRootsResponse} from "@/oss/services/observability/types"

import ResizableTitle from "../../ResizableTitle"

import {getObservabilityColumns} from "./assets/getObservabilityColumns"
import {TestsetTraceData} from "./drawer/TestsetDrawer/assets/types"
import TraceContent from "./drawer/TraceContent"
import TraceHeader from "./drawer/TraceHeader"
import TraceSidePanel from "./drawer/TraceSidePanel"
import TraceTree from "./drawer/TraceTree"

const ObservabilityHeader = dynamic(() => import("./assets/ObservabilityHeader"), {ssr: false})
const EmptyObservability = dynamic(() => import("./assets/EmptyObservability"), {ssr: false})
const TestsetDrawer = dynamic(() => import("./drawer/TestsetDrawer/TestsetDrawer"), {ssr: false})

export type TracesWithAnnotations = _AgentaRootsResponse & {
    annotations: AnnotationDto[] | undefined
    aggregatedEvaluatorMetrics: Record<string, any>
}

const ObservabilityDashboard = () => {
    const {traces, isLoading, traceTabs, fetchTraces} = useObservabilityData()
    const [selectedTraceId, setSelectedTraceId] = useQueryParam("trace", "")
    const [editColumns, setEditColumns] = useState<string[]>(["span_type", "key", "usage", "tag"])
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const [testsetDrawerData, setTestsetDrawerData] = useState<TestsetTraceData[]>([])
    const {data: annotations} = useAnnotations()

    const [isAnnotationsSectionOpen, setIsAnnotationsSectionOpen] = useState(true)

    const tracesWithAnnotations: TracesWithAnnotations[] = useMemo(() => {
        function attachAnnotations(trace: any): any {
            const matchingAnnotations = annotations?.filter(
                (annotation: AnnotationDto) =>
                    annotation.links?.invocation?.trace_id ===
                        (trace.invocationIds?.trace_id || "") &&
                    annotation.links?.invocation?.span_id === (trace.invocationIds?.span_id || ""),
            )

            return {
                ...trace,
                annotations: matchingAnnotations,
                aggregatedEvaluatorMetrics: groupAnnotationsByReferenceId(
                    matchingAnnotations || [],
                ),
                children: trace.children?.map(attachAnnotations),
            }
        }

        return traces.map(attachAnnotations)
    }, [traces, annotations])

    const initialColumns = useMemo(
        () => getObservabilityColumns({annotations: annotations || []}),
        [annotations],
    )
    const [columns, setColumns] = useState<ColumnsType<TracesWithAnnotations>>(initialColumns)

    useEffect(() => {
        setColumns(initialColumns)
    }, [initialColumns])

    const activeTraceIndex = useMemo(
        () =>
            traces?.findIndex((item) =>
                traceTabs === "node"
                    ? item.node.id === selectedTraceId
                    : item.root.id === selectedTraceId,
            ),
        [selectedTraceId, traces, traceTabs],
    )

    const activeTrace = useMemo(
        () => tracesWithAnnotations[activeTraceIndex] ?? null,
        [activeTraceIndex, traces],
    )

    const [selected, setSelected] = useState("")

    useEffect(() => {
        if (!selected) {
            setSelected(activeTrace?.node.id)
        }
    }, [activeTrace, selected])

    useEffect(() => {
        const interval = setInterval(fetchTraces, 300000)

        return () => clearInterval(interval)
    }, [])

    const rowSelection = {
        onChange: (selectedRowKeys: React.Key[]) => {
            setSelectedRowKeys(selectedRowKeys)
        },
    }

    const selectedItem = useMemo(() => {
        if (!tracesWithAnnotations?.length || !selected) return null

        const item = getNodeById(tracesWithAnnotations, selected)
        if (!item || !item.invocationIds) return null

        const {trace_id, span_id} = item.invocationIds

        const matchingAnnotations =
            annotations?.filter(
                (annotation: AnnotationDto) =>
                    annotation.links?.invocation?.trace_id === trace_id &&
                    annotation.links?.invocation?.span_id === span_id,
            ) || []

        return {
            ...item,
            annotations: matchingAnnotations,
        }
    }, [selected, tracesWithAnnotations, traces, annotations])

    const handleResize =
        (key: string) =>
        (_: any, {size}: {size: {width: number}}) => {
            setColumns((cols) => {
                return cols.map((col) => ({
                    ...col,
                    width: col.key === key ? size.width : col.width,
                }))
            })
        }

    const filterColumns = (cols: ColumnsType<any>, hiddenKeys: string[]): ColumnsType<any> => {
        return cols
            .filter((col) => !hiddenKeys.includes(col.key as string))
            .map((col) => {
                if ("children" in col && Array.isArray(col.children)) {
                    const filteredChildren = filterColumns(col.children, hiddenKeys)
                    // Only keep parent if it has visible children
                    if (filteredChildren.length > 0) {
                        return {...col, children: filteredChildren}
                    }
                    // If all children are hidden, remove parent
                    return null
                }
                return col
            })
            .filter(Boolean) as ColumnsType<any>
    }

    const mergedColumns = useMemo(() => {
        return filterColumns(columns, editColumns).map((col) => ({
            ...col,
            width: col.width || 200,
            onHeaderCell: (column: TableColumnType<TracesWithAnnotations[]>) => ({
                width: column.width,
                onResize: handleResize(column.key?.toString()!),
            }),
        }))
    }, [columns, editColumns])

    return (
        <div className="flex flex-col gap-6">
            <Typography.Text className="text-[16px] font-medium mt-5">
                Observability
            </Typography.Text>

            <ObservabilityHeader
                setEditColumns={setEditColumns}
                selectedRowKeys={selectedRowKeys}
                setTestsetDrawerData={setTestsetDrawerData}
                editColumns={editColumns}
                columns={columns}
            />

            <div className="flex flex-col gap-2">
                <Table
                    rowSelection={{
                        type: "checkbox",
                        columnWidth: 48,
                        selectedRowKeys,
                        ...rowSelection,
                    }}
                    loading={isLoading}
                    columns={mergedColumns as TableColumnType<TracesWithAnnotations>[]}
                    dataSource={tracesWithAnnotations}
                    bordered
                    style={{cursor: "pointer"}}
                    onRow={(record) => ({
                        onClick: () => {
                            setSelected(record.node.id)
                            if (traceTabs === "node") {
                                setSelectedTraceId(record.node.id)
                            } else {
                                setSelectedTraceId(record.root.id)
                            }
                        },
                    })}
                    components={{
                        header: {
                            cell: ResizableTitle,
                        },
                    }}
                    pagination={false}
                    scroll={{x: "max-content"}}
                    locale={{
                        emptyText: <EmptyObservability />,
                    }}
                />
            </div>

            <TestsetDrawer
                open={testsetDrawerData.length > 0}
                data={testsetDrawerData}
                onClose={() => {
                    setTestsetDrawerData([])
                    setSelectedRowKeys([])
                }}
            />

            {activeTrace && !!traces?.length && (
                <GenericDrawer
                    open={!!selectedTraceId}
                    onClose={() => setSelectedTraceId("")}
                    expandable
                    headerExtra={
                        <TraceHeader
                            activeTrace={activeTrace}
                            traces={traces}
                            setSelectedTraceId={setSelectedTraceId}
                            activeTraceIndex={activeTraceIndex}
                            setIsAnnotationsSectionOpen={setIsAnnotationsSectionOpen}
                            isAnnotationsSectionOpen={isAnnotationsSectionOpen}
                            setSelected={setSelected}
                        />
                    }
                    mainContent={selectedItem ? <TraceContent activeTrace={selectedItem} /> : null}
                    sideContent={
                        <TraceTree
                            activeTrace={activeTrace}
                            selected={selected}
                            setSelected={setSelected}
                        />
                    }
                    extraContent={
                        isAnnotationsSectionOpen &&
                        selectedItem && <TraceSidePanel activeTrace={selectedItem} />
                    }
                    externalKey={`extraContent-${isAnnotationsSectionOpen}`}
                    className="[&_.ant-drawer-body]:p-0"
                />
            )}
        </div>
    )
}

export default () => (
    <ObservabilityContextProvider>
        <ObservabilityDashboard />
    </ObservabilityContextProvider>
)
