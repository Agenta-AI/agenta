import {useCallback, useEffect, useRef, useState} from "react"

import {Splitter, Spin} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import useTraceDrawer from "@/oss/components/pages/observability/drawer/hooks/useTraceDrawer"
import TraceSidePanel from "@/oss/components/pages/observability/drawer/TraceSidePanel"
import {useObservability} from "@/oss/state/newObservability"
import {useQueryParamState} from "@/oss/state/appState"
import {clearTraceParamAtom} from "@/oss/state/url"

import {
    isDrawerOpenAtom,
    closeTraceDrawerAtom,
    setTraceDrawerActiveSpanAtom,
    setTraceDrawerTraceAtom,
} from "./store/traceDrawerStore"

const TraceContent = dynamic(
    () => import("@/oss/components/pages/observability/drawer/TraceContent"),
)
const TraceHeader = dynamic(() => import("@/oss/components/pages/observability/drawer/TraceHeader"))
const TraceTree = dynamic(() => import("@/oss/components/pages/observability/drawer/TraceTree"))

const TraceDrawer = () => {
    const open = useAtomValue(isDrawerOpenAtom)
    const closeDrawer = useSetAtom(closeTraceDrawerAtom)
    const clearTraceParam = useSetAtom(clearTraceParamAtom)
    const [selected, setSelected] = useState("")
    const {traces, activeSpanId, getTraceById, traceResponse, error, isLoading, traceId} =
        useTraceDrawer()
    const [drawerWidth] = useState(1200)

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

    // Keep component mounted; EnhancedDrawer handles destroyOnHidden. We gate heavy work via memos.

    const activeId = selected || traces[0]?.span_id || ""
    const activeTrace = getTraceById(activeId)

    const handleAfterOpenChange = useCallback(
        (isOpen: boolean) => {
            if (!isOpen) {
                clearTraceParam()
                setSpanQueryParam(undefined, {shallow: true})
            }
        },
        [clearTraceParam, setSpanQueryParam],
    )

    return (
        <EnhancedDrawer
            title={
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
            }
            open={open}
            onClose={closeDrawer}
            width={drawerWidth}
            closeOnLayoutClick={false}
            afterOpenChange={handleAfterOpenChange}
            className="[&_.ant-drawer-body]:p-0"
        >
            <div className="h-full w-full">
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
        </EnhancedDrawer>
    )
}

export default TraceDrawer
