import {useCallback, useState} from "react"

import {DeleteOutlined} from "@ant-design/icons"
import {CaretDown, CaretUp, SidebarSimple} from "@phosphor-icons/react"
import {Button, Space, Tag, Typography} from "antd"

import TooltipWithCopyAction from "@/oss/components/TooltipWithCopyAction"
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

    const {fetchMoreTraces, hasMoreTraces} = useObservability()

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
                traces.findIndex((t: any) => t?.span_id === activeTrace?.span_id),
            )

    const isFirstItem = navIds
        ? resolvedIndex <= 0 || (navIds?.length || 0) <= 1
        : resolvedIndex === 0
    const isLastItem = navIds
        ? resolvedIndex >= (navIds?.length || 1) - 1 || (navIds?.length || 0) <= 1
        : resolvedIndex === traces.length - 1 && !hasMoreTraces

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
            if (hasMoreTraces) {
                try {
                    const newTraces = await fetchMoreTraces()
                    const firstTrace = newTraces[0]
                    if (firstTrace) {
                        const id = firstTrace.span_id
                        setSelectedTraceId(id)
                        setSelectedNode?.(id)
                        setSelected?.(id)
                    }
                } catch (error) {
                    console.error("Error fetching more traces:", error)
                }
            }
        } else {
            const nextTrace = traces[resolvedIndex + 1]
            const id = nextTrace.span_id
            setSelectedTraceId(id)
            setSelectedNode?.(id)
            setSelected?.(id)
        }
    }, [resolvedIndex, navIds, traces, hasMoreTraces, fetchMoreTraces])

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
        if (resolvedIndex > 0) {
            const prevTrace = traces[resolvedIndex - 1]
            const id = prevTrace.span_id
            setSelectedTraceId(id)
            setSelectedNode?.(id)
            setSelected?.(id)
        }
    }, [resolvedIndex, navIds, traces])

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
                        copyText={activeTrace?.trace_id || ""}
                        title="Copy trace id"
                    >
                        <Tag className="font-normal"># {activeTrace?.trace_id || "-"}</Tag>
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
                activeTraceId={activeTrace?.trace_id || ""}
                setSelectedTraceId={setSelectedTraceId}
            />
        </>
    )
}

export default TraceHeader
