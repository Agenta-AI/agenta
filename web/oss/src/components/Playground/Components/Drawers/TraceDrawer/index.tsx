import {cloneElement, isValidElement, useCallback, useMemo, useState} from "react"

import {TreeView} from "@phosphor-icons/react"
import {Button} from "antd"
import clsx from "clsx"
import {getDefaultStore, useSetAtom} from "jotai"

import {openTraceDrawerAtom} from "./store/traceDrawerStore"
import {TraceDrawerButtonProps} from "./types"
import {fetchPreviewTrace} from "@/oss/services/tracing/api"
import {
    transformTracesResponseToTree,
    transformTracingResponse,
} from "@/oss/services/tracing/lib/helpers"

const store = getDefaultStore()

const TraceDrawerButton = ({
    label,
    icon = true,
    children,
    result,
    navigationIds,
    ...props
}: TraceDrawerButtonProps) => {
    const openDrawer = useSetAtom(openTraceDrawerAtom, {store})
    const [loading, setLoading] = useState(false)

    const traceId = useMemo(
        () => result?.response?.trace_id || result?.metadata?.rawError?.detail?.trace_id,
        [result],
    )

    const handleOpen = useCallback(async () => {
        try {
            setLoading(true)
            const data = await fetchPreviewTrace(traceId)
            const transformedData = transformTracingResponse(transformTracesResponseToTree(data))

            const first = Array.isArray(transformedData) ? transformedData[0] : undefined
            // Support both flattened and nested shapes
            const nodeId = (first as any)?.span_id || (first as any)?.trace_id || undefined
            const payload =
                navigationIds && navigationIds.length > 1
                    ? {
                          ...({...result, traces: transformedData} as any),
                          navigationIds,
                          activeTraceId: nodeId,
                      }
                    : {...({...result, traces: transformedData} as any), activeTraceId: nodeId}

            openDrawer({result: payload})
        } catch (error) {
            console.error("TraceDrawerButton error: ", error)
        } finally {
            setLoading(false)
        }
    }, [openDrawer, result, navigationIds, traceId])

    const hasTrace = !!result?.response?.tree?.nodes?.length || !!result?.error

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as React.ReactElement<{onClick: () => void; loading?: boolean}>,
                    {
                        onClick: handleOpen,
                        loading,
                    },
                )
            ) : (
                <Button
                    type="text"
                    icon={icon && <TreeView size={14} />}
                    onClick={handleOpen}
                    loading={loading}
                    {...props}
                    disabled={!hasTrace || !traceId || !!result?.error}
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
