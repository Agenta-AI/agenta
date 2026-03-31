import {useEffect, useRef, useState} from "react"

import {CloseOutlined, FullscreenExitOutlined, FullscreenOutlined} from "@ant-design/icons"
import {Button, Spin, Splitter} from "antd"
import {useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import useTraceDrawer from "@/oss/components/SharedDrawers/TraceDrawer/hooks/useTraceDrawer"
import {useQueryParamState} from "@/oss/state/appState"
import {useObservability} from "@/oss/state/newObservability"

import {setTraceDrawerActiveSpanAtom, setTraceDrawerTraceAtom} from "../store/traceDrawerStore"

const TraceContent = dynamic(
    () => import("@/oss/components/SharedDrawers/TraceDrawer/components/TraceContent"),
)
const TraceHeader = dynamic(
    () => import("@/oss/components/SharedDrawers/TraceDrawer/components/TraceHeader"),
)
const TraceTree = dynamic(
    () => import("@/oss/components/SharedDrawers/TraceDrawer/components/TraceTree"),
)

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
    const [, setTraceQueryParam] = useQueryParamState("trace")
    const [, setSpanQueryParam] = useQueryParamState("span")

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
            setSpanQueryParam(selected, {shallow: true})
        } else {
            setSpanQueryParam(undefined, {shallow: true})
        }
    }, [selected, setActiveSpan, setSpanQueryParam])

    const activeId = selected || traces[0]?.span_id || ""
    const activeTrace = getTraceById(activeId)

    return (
        <div className="h-full w-full flex flex-col" data-tour="trace-drawer">
            <div className="flex items-center gap-3 px-4 py-3 border-0 border-b border-solid border-colorSplit">
                <Button
                    onClick={onClose}
                    type="text"
                    icon={<CloseOutlined />}
                    data-tour="trace-drawer-close"
                />
                <Button
                    onClick={onToggleWidth}
                    type="text"
                    icon={isExpanded ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                />
                <div className="flex-1 min-w-0">
                    <TraceHeader
                        activeTrace={activeTrace as any}
                        activeTraceId={activeId}
                        traceId={traceId}
                        traces={traces as any}
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
            <Spin spinning={Boolean(isLoading)} tip="Loading trace…" size="large">
                <div className="h-full">
                    <Splitter className="h-[calc(100%-48px)]">
                        <Splitter.Panel defaultSize={320} collapsible>
                            <TraceTree
                                activeTraceId={activeId}
                                selected={activeId}
                                setSelected={setSelected}
                            />
                        </Splitter.Panel>
                        <Splitter.Panel min={400}>
                            <TraceContent
                                activeTrace={activeTrace as any}
                                traceResponse={traceResponse}
                                error={error as any}
                                isLoading={isLoading}
                                setSelectedTraceId={setGlobalSelectedTraceId}
                                traces={traces as any}
                                activeId={activeId}
                            />
                        </Splitter.Panel>
                    </Splitter>
                </div>
            </Spin>
        </div>
    )
}

export default TraceDrawerContent
