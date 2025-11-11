import {useCallback, useEffect, useMemo, useState} from "react"

import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import TraceSidePanel from "@/oss/components/pages/observability/drawer/TraceSidePanel"
import {
    buildNodeTree,
    getNodeById,
    observabilityTransformer,
} from "@/oss/lib/helpers/observability_helpers"
import useAnnotations from "@/oss/lib/hooks/useAnnotations"
import {attachAnnotationsToTraces} from "@/oss/lib/hooks/useAnnotations/assets/helpers"
import {_AgentaRootsResponse, AgentaNodeDTO} from "@/oss/services/observability/types"

import {resetTraceDrawerAtom, isDrawerOpenAtom, drawerResultAtom} from "./store/traceDrawerStore"

const GenericDrawer = dynamic(() => import("@/oss/components/GenericDrawer"))
const TraceContent = dynamic(
    () => import("@/oss/components/pages/observability/drawer/TraceContent"),
)
const TraceHeader = dynamic(() => import("@/oss/components/pages/observability/drawer/TraceHeader"))
const TraceTree = dynamic(() => import("@/oss/components/pages/observability/drawer/TraceTree"))

const TraceDrawer = () => {
    const open = useAtomValue(isDrawerOpenAtom)
    const result = useAtomValue(drawerResultAtom)
    const setDrawerState = useSetAtom(resetTraceDrawerAtom)
    const [selected, setSelected] = useState("")
    const traceSpans = result?.response?.tree

    const {data: annotations} = useAnnotations({
        queries: {
            annotation: {
                links:
                    traceSpans?.nodes?.map((node) => ({
                        trace_id: node.trace_id,
                        span_id: node.span_id,
                    })) || [],
            },
        },
        waitUntil: !open,
    })

    const [isAnnotationsSectionOpen, setIsAnnotationsSectionOpen] = useState(true)

    const traces = useMemo(() => {
        if (traceSpans) {
            const rawTraces = traceSpans.nodes
                .flatMap((node) => buildNodeTree(node as AgentaNodeDTO))
                .flatMap((item: any) => observabilityTransformer(item))
            return attachAnnotationsToTraces(rawTraces, annotations || [])
        }
        return []
    }, [traceSpans, annotations])

    const activeTrace = useMemo(
        () =>
            traces
                ? (traces[0] ?? null)
                : result?.error
                  ? ({
                        exception: result?.metadata?.rawError,
                        node: {name: "Exception"},
                        status: {code: "ERROR"},
                    } as _AgentaRootsResponse)
                  : null,
        [traces, result],
    )

    useEffect(() => {
        if (!selected) {
            setSelected(activeTrace?.node.id ?? "")
        }
    }, [activeTrace, selected])

    const selectedItem = useMemo(
        () => (traces?.length ? getNodeById(traces, selected) : null),
        [selected, traces],
    )

    const handleClose = useCallback(() => {
        setDrawerState({open: false, result: null})
        setSelected("")
    }, [setDrawerState])

    return (
        <GenericDrawer
            open={open}
            onClose={handleClose}
            expandable
            headerExtra={
                !!activeTrace && !!traces ? (
                    <TraceHeader
                        activeTrace={activeTrace}
                        traces={(traces as _AgentaRootsResponse[]) || []}
                        setSelectedTraceId={handleClose}
                        activeTraceIndex={0}
                        setIsAnnotationsSectionOpen={setIsAnnotationsSectionOpen}
                        isAnnotationsSectionOpen={isAnnotationsSectionOpen}
                    />
                ) : null
            }
            mainContent={
                activeTrace ? (
                    <TraceContent
                        activeTrace={selectedItem || (activeTrace as _AgentaRootsResponse)}
                    />
                ) : null
            }
            sideContent={
                activeTrace ? (
                    <TraceTree
                        activeTrace={activeTrace as _AgentaRootsResponse}
                        selected={selected}
                        setSelected={setSelected}
                    />
                ) : null
            }
            extraContent={
                isAnnotationsSectionOpen &&
                selectedItem && <TraceSidePanel activeTrace={selectedItem} />
            }
            externalKey={`extraContent-${isAnnotationsSectionOpen}`}
            className="[&_.ant-drawer-body]:p-0"
        />
    )
}

export default TraceDrawer
