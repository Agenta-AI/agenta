import {useEffect, useRef, useState} from "react"

import {CloseOutlined, FullscreenExitOutlined, FullscreenOutlined} from "@ant-design/icons"
import {Button, Splitter, Spin} from "antd"
import {useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import useTraceDrawer from "@/oss/components/pages/observability/drawer/hooks/useTraceDrawer"
import TraceSidePanel from "@/oss/components/pages/observability/drawer/TraceSidePanel"
import {useQueryParamState} from "@/oss/state/appState"
import {useObservability} from "@/oss/state/newObservability"

import {setTraceDrawerActiveSpanAtom, setTraceDrawerTraceAtom} from "./store/traceDrawerStore"

const TraceContent = dynamic(
    () => import("@/oss/components/pages/observability/drawer/TraceContent"),
)
const TraceHeader = dynamic(() => import("@/oss/components/pages/observability/drawer/TraceHeader"))
const TraceTree = dynamic(() => import("@/oss/components/pages/observability/drawer/TraceTree"))

interface TraceDrawerContentProps {
    drawerWidth: number
    setDrawerWidth: (updater: (prev: number) => number) => void
    onClose: () => void
}

const initialWidth = 1200

const TraceDrawerContent = ({drawerWidth, setDrawerWidth, onClose}: TraceDrawerContentProps) => {
    const [selected, setSelected] = useState("")

    const {traces, activeSpanId, getTraceById, traceResponse, error, isLoading, traceId} =
        useTraceDrawer()

    const [isAnnotationsSectionOpen, setIsAnnotationsSectionOpen] = useState(true)
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

    const header = (
        <div className="flex items-center gap-3">
            <Button onClick={() => onClose()} type="text" icon={<CloseOutlined />} />

            <Button
                onClick={() =>
                    setDrawerWidth((width) => (width === initialWidth ? 1920 : initialWidth))
                }
                type="text"
                icon={
                    drawerWidth === initialWidth ? (
                        <FullscreenOutlined />
                    ) : (
                        <FullscreenExitOutlined />
                    )
                }
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
                    setIsAnnotationsSectionOpen={setIsAnnotationsSectionOpen}
                    isAnnotationsSectionOpen={isAnnotationsSectionOpen}
                    setSelected={setSelected}
                />
            </div>
        </div>
    )

    return (
        <div className="h-full w-full">
            {header}
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
                        <Splitter.Panel min={400} defaultSize={640}>
                            <TraceContent
                                activeTrace={activeTrace as any}
                                traceResponse={traceResponse}
                                error={error as any}
                                isLoading={isLoading}
                            />
                        </Splitter.Panel>
                        {isAnnotationsSectionOpen && (
                            <Splitter.Panel min={200} defaultSize={320} collapsible>
                                <TraceSidePanel
                                    activeTrace={activeTrace as any}
                                    activeTraceId={activeId}
                                    isLoading={isLoading}
                                />
                            </Splitter.Panel>
                        )}
                    </Splitter>
                </div>
            </Spin>
        </div>
    )
}

export default TraceDrawerContent
