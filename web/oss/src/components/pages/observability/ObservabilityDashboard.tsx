import {useEffect, useMemo, useState} from "react"

import {Table, TableColumnType, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import {useAtomValue} from "jotai"
import {useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {TraceDrawer} from "@/oss/components/Playground/Components/Drawers/TraceDrawer"
import {
    isDrawerOpenAtom,
    openTraceDrawerAtom,
} from "@/oss/components/Playground/Components/Drawers/TraceDrawer/store/traceDrawerStore"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {TracesWithAnnotations} from "@/oss/services/observability/types"
import {useObservability, annotationEvaluatorSlugsAtom} from "@/oss/state/newObservability"

import {filterColumns} from "../../Filters/EditColumns/assets/helper"
import ResizableTitle from "../../ResizableTitle"

import {getObservabilityColumns} from "./assets/getObservabilityColumns"

const ObservabilityHeader = dynamic(() => import("./assets/ObservabilityHeader"), {ssr: false})
const EmptyObservability = dynamic(() => import("./assets/EmptyObservability"), {ssr: false})
const TestsetDrawer = dynamic(() => import("./drawer/TestsetDrawer/TestsetDrawer"), {ssr: false})

const ObservabilityDashboard = () => {
    const {
        traces,
        isLoading,
        traceTabs,
        fetchTraces,
        selectedTraceId,
        setSelectedTraceId,
        editColumns,
        // setEditColumns,
        selectedRowKeys,
        setSelectedRowKeys,
        testsetDrawerData,
        setTestsetDrawerData,
        // isAnnotationsSectionOpen,
        // setIsAnnotationsSectionOpen,
        selectedNode,
        setSelectedNode,
        activeTrace,
        // activeTraceIndex,
        // selectedItem,
    } = useObservability()
    const evaluatorSlugs = useAtomValue(annotationEvaluatorSlugsAtom)
    const openTraceDrawer = useSetAtom(openTraceDrawerAtom)
    const isTraceDrawerOpen = useAtomValue(isDrawerOpenAtom)

    const [traceParam, setTraceParam] = useQueryParam("trace", "")

    const initialColumns = useMemo(
        () => getObservabilityColumns({evaluatorSlugs}),
        [evaluatorSlugs],
    )
    const [columns, setColumns] = useState<ColumnsType<TracesWithAnnotations>>(initialColumns)

    useEffect(() => {
        setColumns(initialColumns)
    }, [initialColumns])

    useEffect(() => {
        if (traceParam && traceParam !== selectedTraceId) {
            setSelectedTraceId(traceParam)
        }
    }, [traceParam])

    useEffect(() => {
        if (selectedTraceId !== traceParam) {
            setTraceParam(selectedTraceId)
        }
    }, [selectedTraceId])

    // Open global TraceDrawer when a trace is selected
    useEffect(() => {
        if (selectedTraceId && traces && traces.length > 0) {
            const navigationIds = (traces || []).map((t: any) => t?.node?.id).filter(Boolean)
            const activeNodeId = selectedNode || activeTrace?.node?.id || navigationIds[0] || ""
            openTraceDrawer({
                result: {
                    traces,
                    navigationIds,
                    activeTraceId: activeNodeId,
                },
            })
        }
    }, [selectedTraceId, traces, selectedNode, activeTrace])

    useEffect(() => {
        if (!selectedNode) {
            setSelectedNode(activeTrace?.node.id)
        }
    }, [activeTrace, selectedNode])

    useEffect(() => {
        if (!isTraceDrawerOpen && selectedTraceId) {
            setSelectedTraceId("")
            setTraceParam("")
        }
    }, [isTraceDrawerOpen, selectedTraceId, setSelectedTraceId, setTraceParam])

    useEffect(() => {
        const interval = setInterval(fetchTraces, 300000)

        return () => clearInterval(interval)
    }, [])

    const rowSelection = {
        onChange: (keys: React.Key[]) => {
            setSelectedRowKeys(keys)
        },
    }

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
            <Typography.Text className="text-[16px] font-medium">Observability</Typography.Text>

            <ObservabilityHeader columns={columns} />

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
                    dataSource={traces}
                    bordered
                    style={{cursor: "pointer"}}
                    onRow={(record) => ({
                        onClick: () => {
                            setSelectedNode(record.node.id)
                            const targetId = traceTabs === "node" ? record.node.id : record.root.id
                            setSelectedTraceId(targetId)
                            // Open global Trace Drawer immediately with current traces payload
                            openTraceDrawer({
                                result: {
                                    traces,
                                    navigationIds: (traces || [])
                                        .map((t: any) => t?.node?.id)
                                        .filter(Boolean),
                                    activeTraceId: record.node.id,
                                },
                            })
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

            <TraceDrawer />
        </div>
    )
}

export default ObservabilityDashboard
