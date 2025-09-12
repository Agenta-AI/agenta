import {useCallback, useMemo, useState} from "react"

import {DeleteOutlined} from "@ant-design/icons"
import {CaretDown, CaretUp, SidebarSimple} from "@phosphor-icons/react"
import {Button, Space, Tag, Typography} from "antd"

import TooltipWithCopyAction from "@/oss/components/TooltipWithCopyAction"
import {_AgentaRootsResponse} from "@/oss/services/observability/types"
import {useObservability} from "@/oss/state/newObservability"

import DeleteTraceModal from "../../components/DeleteTraceModal"
import useTraceDrawer from "../hooks/useTraceDrawer"

import {useStyles} from "./assets/styles"
import {TraceHeaderProps} from "./assets/types"

const TraceHeader = ({
    activeTrace: propActiveTrace,
    traces: propTraces,
    activeTraceId,
    navigationIds,
    setSelectedTraceId,
    setSelectedNode,
    activeTraceIndex,
    setIsAnnotationsSectionOpen,
    isAnnotationsSectionOpen,
    setSelected,
}: TraceHeaderProps) => {
    const classes = useStyles()
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

    const {pagination, count, navigateToPage, fetchTraces, traceTabs} = useObservability()

    // Derive from drawer hook when only id is given
    const {traces: hookTraces, getTraceById} = useTraceDrawer()

    const traces = ((propTraces as any) || hookTraces) ?? []
    const activeTrace =
        (propActiveTrace as any) || (activeTraceId ? getTraceById(activeTraceId) : undefined)

    // Prefer explicit navigation list when provided (including empty array)
    const navIds = navigationIds
    const resolvedIndex = navIds
        ? Math.max(0, navIds.indexOf(activeTraceId || ""))
        : typeof activeTraceIndex === "number"
          ? activeTraceIndex
          : Math.max(
                0,
                traces.findIndex((t: any) => t?.node?.id === activeTrace?.node?.id),
            )

    const isFirstItem = navIds
        ? resolvedIndex <= 0 || (navIds?.length || 0) <= 1
        : pagination.page === 1 && resolvedIndex === 0
    const isLastItem = navIds
        ? resolvedIndex >= (navIds?.length || 1) - 1 || (navIds?.length || 0) <= 1
        : pagination.page === Math.ceil(count / pagination.size) &&
          resolvedIndex === traces.length - 1

    const handleNextTrace = useCallback(async () => {
        if (resolvedIndex === undefined) return

        if (navIds) {
            if ((navIds?.length || 0) <= 1) return
            // Use explicit list when provided
            if (resolvedIndex >= navIds.length - 1) return
            const id = navIds[resolvedIndex + 1]
            setSelectedTraceId(id)
            setSelectedNode?.(id)
            setSelected?.(id)
            return
        }

        // Check if we're at the last item of the current page
        if (resolvedIndex === traces.length - 1) {
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
                        // Always select by node id to keep drawer lean and stable
                        const id = firstTrace.node.id
                        setSelectedTraceId(id)
                        setSelectedNode?.(id)
                        setSelected?.(id)
                    }
                } catch (error) {
                    console.error("Error navigating to next page:", error)
                }
            }
        } else {
            // Regular next item within current page
            const nextTrace = traces[resolvedIndex + 1]
            // Always select by node id to keep drawer lean and stable
            const id = nextTrace.node.id
            setSelectedTraceId(id)
            setSelectedNode?.(id)
            setSelected?.(id)
        }
    }, [resolvedIndex, navIds, traces, pagination, count, navigateToPage, fetchTraces])

    const handlePrevTrace = useCallback(async () => {
        if (resolvedIndex === undefined) return

        if (navIds) {
            if ((navIds?.length || 0) <= 1) return
            if (resolvedIndex <= 0) return
            const id = navIds[resolvedIndex - 1]
            setSelectedTraceId(id)
            setSelectedNode?.(id)
            setSelected?.(id)
            return
        }

        // Check if we're at the first item of the current page
        if (resolvedIndex === 0 && pagination.page > 1) {
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
                    // Always select by node id to keep drawer lean and stable
                    const id = lastTrace.node.id
                    setSelectedTraceId(id)
                    setSelectedNode?.(id)
                    setSelected?.(id)
                }
            } catch (error) {
                console.error("Error navigating to previous page:", error)
            }
        } else if (resolvedIndex > 0) {
            // Regular previous item within current page
            const prevTrace = traces[resolvedIndex - 1]
            // Always select by node id to keep drawer lean and stable
            const id = prevTrace.node.id
            setSelectedTraceId(id)
            setSelectedNode?.(id)
            setSelected?.(id)
        }
    }, [resolvedIndex, navIds, traces, pagination, navigateToPage, fetchTraces])

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
                    <TooltipWithCopyAction
                        copyText={activeTrace?.root?.id || ""}
                        title="Copy trace id"
                    >
                        <Tag className="font-normal"># {activeTrace?.root?.id || "-"}</Tag>
                    </TooltipWithCopyAction>
                </Space>

                <Space>
                    <Button
                        icon={<DeleteOutlined />}
                        onClick={() => setIsDeleteModalOpen(true)}
                        disabled={!activeTrace}
                    />
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
                activeTraceNodeId={activeTrace?.node?.id || ""}
                setSelectedTraceId={setSelectedTraceId}
            />
        </>
    )
}

export default TraceHeader
