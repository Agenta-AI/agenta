import {useEffect, useRef, useState} from "react"

import {Splitter} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import useTraceDrawer from "@/oss/components/pages/observability/drawer/hooks/useTraceDrawer"
import TraceSidePanel from "@/oss/components/pages/observability/drawer/TraceSidePanel"
import {useObservability} from "@/oss/state/newObservability"

import {isDrawerOpenAtom, closeTraceDrawerAtom} from "./store/traceDrawerStore"

const TraceContent = dynamic(
    () => import("@/oss/components/pages/observability/drawer/TraceContent"),
)
const TraceHeader = dynamic(() => import("@/oss/components/pages/observability/drawer/TraceHeader"))
const TraceTree = dynamic(() => import("@/oss/components/pages/observability/drawer/TraceTree"))

const TraceDrawer = () => {
    const open = useAtomValue(isDrawerOpenAtom)
    const closeDrawer = useSetAtom(closeTraceDrawerAtom)
    const [selected, setSelected] = useState("")
    const {
        traces,
        navigationIds: payloadNavIds,
        activeTraceId: payloadActiveId,
        getTraceById,
    } = useTraceDrawer()
    const [drawerWidth] = useState(1200)

    const [isAnnotationsSectionOpen, setIsAnnotationsSectionOpen] = useState(true)
    const {setSelectedTraceId: setGlobalSelectedTraceId, setSelectedNode: setGlobalSelectedNode} =
        useObservability()

    // Initialize selection when drawer payload changes
    const lastPayloadActiveIdRef = useRef<string | undefined>(undefined)

    useEffect(() => {
        if (payloadActiveId) {
            const hasChanged = lastPayloadActiveIdRef.current !== payloadActiveId
            lastPayloadActiveIdRef.current = payloadActiveId

            if (hasChanged || !selected) {
                setSelected(payloadActiveId)
            }
            return
        }

        if (!selected && traces.length > 0) {
            setSelected(traces[0]?.span_id || "")
        }
    }, [payloadActiveId, traces, selected])

    // If current selection is not found in the latest traces (e.g., user clicked a different row), re-anchor
    useEffect(() => {
        if (selected && traces.length > 0) {
            const exists = getTraceById(selected)
            if (!exists) {
                setSelected(payloadActiveId || traces[0]?.span_id || "")
            }
        }
    }, [selected, traces, payloadActiveId, getTraceById])

    // Keep component mounted; EnhancedDrawer handles destroyOnHidden. We gate heavy work via memos.

    const navigationIds =
        payloadNavIds && payloadNavIds.length > 1
            ? payloadNavIds
            : traces?.length
              ? traces.map((t: any) => t.span_id)
              : []

    const activeId = selected || traces[0]?.span_id || ""

    return (
        <EnhancedDrawer
            title={
                <TraceHeader
                    activeTraceId={activeId}
                    navigationIds={navigationIds}
                    setSelectedTraceId={setGlobalSelectedTraceId}
                    setSelectedNode={setGlobalSelectedNode}
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
            className="[&_.ant-drawer-body]:p-0"
        >
            <Splitter className="h-[calc(100%-48px)]">
                <Splitter.Panel defaultSize={320} collapsible>
                    <TraceTree
                        activeTraceId={activeId}
                        selected={activeId}
                        setSelected={setSelected}
                    />
                </Splitter.Panel>
                <Splitter.Panel min={400} defaultSize={640}>
                    <TraceContent activeTraceId={activeId} />
                </Splitter.Panel>
                {isAnnotationsSectionOpen && (
                    <Splitter.Panel min={200} defaultSize={320} collapsible>
                        <TraceSidePanel activeTraceId={activeId} />
                    </Splitter.Panel>
                )}
            </Splitter>
        </EnhancedDrawer>
    )
}

export default TraceDrawer
