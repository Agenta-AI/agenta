import {useEffect, useRef, useState} from "react"

import {useObservability} from "@agenta/observability"
import {useTraceDrawer} from "@agenta/observability/traceDrawer"
import {traceDrawerSetQueryParam} from "@agenta/observability/traceDrawer"
import {
    setTraceDrawerActiveSpanAtom,
    setTraceDrawerTraceAtom,
} from "@agenta/observability/traceDrawer"
import {EnhancedButton} from "@agenta/ui/components/presentational"
import {ArrowsIn, ArrowsOut, X} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {SkeletonBlock} from "../primitives/SkeletonBlock"

const TraceContent = dynamic(() => import("./TraceContent"))
const TraceHeader = dynamic(() => import("./TraceHeader"))
const TraceTree = dynamic(() => import("./TraceTree"))

interface TraceDrawerContentProps {
    onClose: () => void
    onToggleWidth: () => void
    isExpanded: boolean
}

const TraceDrawerContent = ({onClose, onToggleWidth, isExpanded}: TraceDrawerContentProps) => {
    const [selected, setSelected] = useState("")
    const {traces, activeSpanId, getTraceById, traceResponse, error, isLoading, traceId} =
        useTraceDrawer()
    const {
        traceTabs,
        filters,
        sort,
        limit,
        setSelectedTraceId: setGlobalSelectedTraceId,
        setSelectedNode: setGlobalSelectedNode,
    } = useObservability()
    const setActiveSpan = useSetAtom(setTraceDrawerActiveSpanAtom)
    const setTraceDrawerTrace = useSetAtom(setTraceDrawerTraceAtom)
    const setTraceQueryParam = (value: string | null | undefined) =>
        traceDrawerSetQueryParam("trace", value)
    const setSpanQueryParam = (value: string | null | undefined) =>
        traceDrawerSetQueryParam("span", value)

    // Initialize selection when drawer payload changes
    const lastPayloadActiveIdRef = useRef<string | undefined>(undefined)

    useEffect(() => {
        const incomingId = activeSpanId || traces[0]?.span_id || ""
        if (!incomingId) {
            setSelected("")
            lastPayloadActiveIdRef.current = undefined
            return
        }

        const hasChanged = lastPayloadActiveIdRef.current !== incomingId
        lastPayloadActiveIdRef.current = incomingId

        if (hasChanged || !selected) {
            setSelected(incomingId)
        }
    }, [activeSpanId, traces, selected])

    // If current selection is not found in the latest traces (e.g., user clicked a different row), re-anchor
    useEffect(() => {
        if (selected && traces.length > 0) {
            const exists = getTraceById(selected)
            if (!exists) {
                setSelected(activeSpanId || traces[0]?.span_id || "")
            }
        }
    }, [selected, traces, activeSpanId, getTraceById])

    useEffect(() => {
        if (selected) {
            setActiveSpan(selected)
            setSpanQueryParam(selected)
        } else {
            setSpanQueryParam(null)
        }
    }, [selected, setActiveSpan, setSpanQueryParam])

    const activeId = selected || traces[0]?.span_id || ""
    const activeTrace = getTraceById(activeId)

    return (
        <div className="h-full w-full flex flex-col" data-tour="trace-drawer">
            <div className="flex items-center gap-3 px-4 py-3 border-0 border-b border-solid border-colorSplit">
                <EnhancedButton
                    onClick={onClose}
                    type="text"
                    icon={<X size={14} />}
                    data-tour="trace-drawer-close"
                />
                <EnhancedButton
                    onClick={onToggleWidth}
                    type="text"
                    icon={isExpanded ? <ArrowsIn size={14} /> : <ArrowsOut size={14} />}
                />
                <div className="flex-1 min-w-0">
                    <TraceHeader
                        activeTrace={activeTrace as never}
                        activeTraceId={activeId}
                        traceId={traceId}
                        traces={traces as never}
                        traceTabs={traceTabs}
                        filters={filters}
                        sort={sort}
                        limit={limit}
                        setSelectedTraceId={setGlobalSelectedTraceId}
                        setSelectedNode={setGlobalSelectedNode}
                        setTraceParam={setTraceQueryParam}
                        setSpanParam={setSpanQueryParam}
                        setTraceDrawerTrace={setTraceDrawerTrace}
                        activeTraceIndex={0}
                        setSelected={setSelected}
                    />
                </div>
            </div>
            {/* antd `Spin` wrapped the body and dimmed it; the tree/content render their own
                skeletons, so a loading pass just shows a block above them. */}
            <div className="flex-1 min-h-0">
                {isLoading ? <SkeletonBlock className="m-3" /> : null}
                <div className="h-full">
                    {/* antd Splitter: a 320px tree column beside the content. */}
                    <div className="flex h-full">
                        <div className="w-[320px] min-w-[320px] shrink-0">
                            <TraceTree
                                activeTraceId={activeId}
                                selected={activeId}
                                setSelected={setSelected}
                            />
                        </div>
                        <div className="flex-1 min-w-[400px]">
                            <TraceContent
                                activeTrace={activeTrace as never}
                                traceResponse={traceResponse}
                                error={error as never}
                                isLoading={isLoading}
                                setSelectedTraceId={setGlobalSelectedTraceId}
                                traces={traces as never}
                                activeId={activeId}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default TraceDrawerContent
