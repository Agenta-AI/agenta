import {cloneElement, isValidElement, useCallback, useEffect, useMemo, useState} from "react"

import {TreeView} from "@phosphor-icons/react"
import {Button} from "antd"
import clsx from "clsx"

import {traceDrawerJotaiStore, traceDrawerAtom} from "./store/traceDrawerStore"
import {TraceDrawerButtonProps} from "./types"
import {buildNodeTree, observabilityTransformer} from "@/oss/lib/helpers/observability_helpers"
import {_AgentaRootsResponse, AgentaNodeDTO} from "@/oss/services/observability/types"
import {attachAnnotationsToTraces} from "@/oss/lib/hooks/useAnnotations/assets/helpers"
import useAnnotations from "@/oss/lib/hooks/useAnnotations"
import {useAtomValue} from "jotai"

const TraceDrawerButton = ({
    label,
    icon = true,
    children,
    result,
    ...props
}: TraceDrawerButtonProps) => {
    const [selected, setSelected] = useState("")
    const {open} = useAtomValue(traceDrawerAtom)
    const traceSpans = result?.response?.tree

    const {data: annotations} = useAnnotations({
        queries: {
            annotation: {
                links:
                    traceSpans?.nodes?.map((node) => ({
                        trace_id: node?.trace_id,
                        span_id: node?.span_id,
                    })) || [],
            },
        },
        waitUntil: !open,
    })

    const traces = useMemo(() => {
        if (traceSpans) {
            const rawTraces = traceSpans.nodes
                .flatMap((node) => buildNodeTree(node as AgentaNodeDTO))
                .flatMap((item: any) => observabilityTransformer(item))
            return attachAnnotationsToTraces(rawTraces, annotations || [])
        }
        return []
    }, [traceSpans, annotations])

    const handleOpen = useCallback(() => {
        traceDrawerJotaiStore.set(traceDrawerAtom, {open: true, result})
    }, [])

    const activeTrace = useMemo(
        () =>
            traces
                ? traces[0] ?? null
                : result?.error
                  ? ({
                        exception: result?.metadata?.rawError,
                        node: {name: "Exception"},
                        status: {code: "ERROR"},
                    } as _AgentaRootsResponse)
                  : null,
        [traces],
    )

    useEffect(() => {
        if (!selected) {
            setSelected(activeTrace?.node.id ?? "")
        }
    }, [activeTrace, selected])

    const hasTrace = !!result?.response?.tree?.nodes?.length || !!result?.error

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(children as React.ReactElement<{onClick: () => void}>, {
                    onClick: handleOpen,
                })
            ) : (
                <Button
                    type="text"
                    icon={icon && <TreeView size={14} />}
                    onClick={handleOpen}
                    {...props}
                    disabled={!hasTrace}
                    className={clsx([props.className])}
                >
                    {label}
                </Button>
            )}
        </>
    )
}

export default TraceDrawerButton
export {default as TraceDrawer} from "./TraceDrawer"
