import {useCallback, useState} from "react"

import {DeleteOutlined} from "@ant-design/icons"
import {CaretDown, CaretUp, SidebarSimple} from "@phosphor-icons/react"
import {Button, Space, Tag, Typography} from "antd"

import TooltipWithCopyAction from "@/oss/components/TooltipWithCopyAction"
import {useObservabilityData} from "@/oss/contexts/observability.context"
import {_AgentaRootsResponse} from "@/oss/services/observability/types"

import DeleteTraceModal from "../../components/DeleteTraceModal"

import {useStyles} from "./assets/styles"
import {TraceHeaderProps} from "./assets/types"

const TraceHeader = ({
    activeTrace,
    traces,
    setSelectedTraceId,
    activeTraceIndex,
    setIsAnnotationsSectionOpen,
    isAnnotationsSectionOpen,
    setSelected,
}: TraceHeaderProps) => {
    const classes = useStyles()
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

    const {pagination, count, navigateToPage, fetchTraces, traceTabs} = useObservabilityData()

    const isFirstItem = pagination.page === 1 && activeTraceIndex === 0
    const isLastItem =
        pagination.page === Math.ceil(count / pagination.size) &&
        activeTraceIndex === traces.length - 1

    const handleNextTrace = useCallback(async () => {
        if (activeTraceIndex === undefined) return

        // Check if we're at the last item of the current page
        if (activeTraceIndex === traces.length - 1) {
            const nextPage = pagination.page + 1
            const totalPages = Math.ceil(count / pagination.size)

            // Check if next page exists
            if (nextPage <= totalPages) {
                try {
                    // First fetch the next page data
                    await navigateToPage(nextPage)

                    // Get the updated traces data
                    const updatedData: any = await fetchTraces()

                    const nextPageTraces = updatedData?.traces || []

                    // Set the first item of the new page as selected
                    if (nextPageTraces.length > 0) {
                        const firstTrace = nextPageTraces[0]
                        const id = traceTabs === "node" ? firstTrace.node.id : firstTrace.root.id
                        setSelectedTraceId(id)
                        setSelected?.(firstTrace.node.id)
                    }
                } catch (error) {
                    console.error("Error navigating to next page:", error)
                }
            }
        } else {
            // Regular next item within current page
            const nextTrace = traces[activeTraceIndex + 1]
            const id = traceTabs === "node" ? nextTrace.node.id : nextTrace.root.id
            setSelectedTraceId(id)
            setSelected?.(nextTrace.node.id)
        }
    }, [activeTraceIndex, traces, traceTabs, pagination, count, navigateToPage, fetchTraces])

    const handlePrevTrace = useCallback(async () => {
        if (activeTraceIndex === undefined) return

        // Check if we're at the first item of the current page
        if (activeTraceIndex === 0 && pagination.page > 1) {
            const prevPage = pagination.page - 1

            try {
                // First fetch the previous page data
                await navigateToPage(prevPage)

                // Get the updated traces data
                const updatedData: any = await fetchTraces()
                const prevPageTraces = updatedData?.traces || []

                // Set the last item of the previous page as selected
                if (prevPageTraces.length > 0) {
                    const lastTrace = prevPageTraces[prevPageTraces.length - 1]
                    const id = traceTabs === "node" ? lastTrace.node.id : lastTrace.root.id
                    setSelectedTraceId(id)
                    setSelected?.(lastTrace.node.id)
                }
            } catch (error) {
                console.error("Error navigating to previous page:", error)
            }
        } else if (activeTraceIndex > 0) {
            // Regular previous item within current page
            const prevTrace = traces[activeTraceIndex - 1]
            const id = traceTabs === "node" ? prevTrace.node.id : prevTrace.root.id
            setSelectedTraceId(id)
            setSelected?.(prevTrace.node.id)
        }
    }, [activeTraceIndex, traces, traceTabs, pagination, navigateToPage, fetchTraces])

    return (
        <>
            <div className="flex items-center justify-between">
                <Space>
                    <div>
                        <Button
                            onClick={handlePrevTrace}
                            type="text"
                            disabled={isFirstItem}
                            icon={<CaretUp size={16} />}
                        />
                        <Button
                            onClick={handleNextTrace}
                            type="text"
                            disabled={isLastItem}
                            icon={<CaretDown size={16} />}
                        />
                    </div>

                    <Typography.Text className={classes.title}>Trace</Typography.Text>
                    <TooltipWithCopyAction copyText={activeTrace.root.id} title="Copy trace id">
                        <Tag className="font-normal"># {activeTrace.root.id}</Tag>
                    </TooltipWithCopyAction>
                </Space>

                <Space>
                    <Button icon={<DeleteOutlined />} onClick={() => setIsDeleteModalOpen(true)} />
                    {setIsAnnotationsSectionOpen && (
                        <Button
                            icon={<SidebarSimple size={14} />}
                            type={isAnnotationsSectionOpen ? "default" : "primary"}
                            className="shrink-0 flex items-center justify-center"
                            onClick={() => setIsAnnotationsSectionOpen((prev) => !prev)}
                        />
                    )}
                </Space>
            </div>

            <DeleteTraceModal
                open={isDeleteModalOpen}
                onCancel={() => setIsDeleteModalOpen(false)}
                activeTraceNodeId={activeTrace.node.id}
                setSelectedTraceId={setSelectedTraceId}
            />
        </>
    )
}

export default TraceHeader
