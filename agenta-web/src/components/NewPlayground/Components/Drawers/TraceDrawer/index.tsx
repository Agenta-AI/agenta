import {cloneElement, isValidElement, useEffect, useMemo, useState} from "react"

import clsx from "clsx"
import dynamic from "next/dynamic"
import {Button} from "antd"
import {TreeView} from "@phosphor-icons/react"
import {TraceDrawerButtonProps} from "./types"
import {_AgentaRootsResponse, AgentaNodeDTO} from "@/services/observability/types"
import {
    buildNodeTree,
    getNodeById,
    observabilityTransformer,
} from "@/lib/helpers/observability_helpers"

const GenericDrawer = dynamic(() => import("@/components/GenericDrawer"))
const TraceContent = dynamic(() => import("@/components/pages/observability/drawer/TraceContent"))
const TraceHeader = dynamic(() => import("@/components/pages/observability/drawer/TraceHeader"))
const TraceTree = dynamic(() => import("@/components/pages/observability/drawer/TraceTree"))

const TraceDrawerButton = ({
    label,
    icon = true,
    children,
    result,
    ...props
}: TraceDrawerButtonProps) => {
    const [selected, setSelected] = useState("")
    const [isTraceDrawerOpen, setIsTraceDrawerOpen] = useState(false)
    const traceSpans = result?.response?.tree

    const traces = useMemo(() => {
        if (traceSpans && traceSpans) {
            return traceSpans.nodes
                .flatMap((node) => buildNodeTree(node as AgentaNodeDTO))
                .flatMap((item: any) => observabilityTransformer(item))
        }
    }, [traceSpans])

    const activeTrace = useMemo(() => (traces ? traces[0] ?? null : null), [traces])

    useEffect(() => {
        if (!selected) {
            setSelected(activeTrace?.node.id ?? "")
        }
    }, [activeTrace, selected])

    const selectedItem = useMemo(
        () => (traces?.length ? getNodeById(traces, selected) : null),
        [selected, traces],
    )
    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as React.ReactElement<{
                        onClick: () => void
                    }>,
                    {
                        onClick: () => {
                            setIsTraceDrawerOpen(true)
                        },
                    },
                )
            ) : (
                <Button
                    type="text"
                    icon={icon && <TreeView size={14} />}
                    onClick={() => setIsTraceDrawerOpen(true)}
                    {...props}
                    disabled={!traces}
                    className={clsx([props.className])}
                >
                    {label}
                </Button>
            )}

            {isTraceDrawerOpen && (
                <GenericDrawer
                    open={isTraceDrawerOpen}
                    onClose={() => setIsTraceDrawerOpen(false)}
                    expandable
                    headerExtra={
                        !!activeTrace && !!traces ? (
                            <TraceHeader
                                activeTrace={activeTrace as _AgentaRootsResponse}
                                traces={(traces as _AgentaRootsResponse[]) || []}
                                setSelectedTraceId={() => setIsTraceDrawerOpen(false)}
                                activeTraceIndex={0}
                            />
                        ) : null
                    }
                    mainContent={selectedItem ? <TraceContent activeTrace={selectedItem} /> : null}
                    sideContent={
                        <TraceTree
                            activeTrace={activeTrace as _AgentaRootsResponse}
                            selected={selected}
                            x
                            setSelected={setSelected}
                        />
                    }
                />
            )}
        </>
    )
}

export default TraceDrawerButton
