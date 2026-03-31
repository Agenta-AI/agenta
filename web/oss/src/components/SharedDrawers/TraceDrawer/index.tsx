import {cloneElement, isValidElement, useCallback, useMemo} from "react"

import {TreeView} from "@phosphor-icons/react"
import {Button} from "antd"
import clsx from "clsx"
import {useSetAtom} from "jotai"

import {useQueryParamState} from "@/oss/state/appState"

import {openTraceDrawerAtom, setTraceDrawerActiveSpanAtom} from "./store/traceDrawerStore"
import {TraceDrawerButtonProps} from "./types"

const TraceDrawerButton = ({
    label,
    icon = true,
    children,
    result,
    ...props
}: TraceDrawerButtonProps) => {
    const setActiveSpan = useSetAtom(setTraceDrawerActiveSpanAtom)
    const openTraceDrawer = useSetAtom(openTraceDrawerAtom)
    const [, setTraceQueryParam] = useQueryParamState("trace")
    const [, setSpanQueryParam] = useQueryParamState("span")

    const traceId = useMemo(() => {
        const directTraceId =
            result?.response?.trace_id || result?.metadata?.rawError?.detail?.trace_id
        if (directTraceId) return directTraceId

        const responseTrace = (result as any)?.response?.trace
        if (responseTrace?.trace_id) return responseTrace.trace_id

        const nodes = (result as any)?.response?.tree?.nodes
        const extractTraceId = (value: any): string | null => {
            if (!value) return null
            if (Array.isArray(value)) {
                for (const entry of value) {
                    const found = extractTraceId(entry)
                    if (found) return found
                }
                return null
            }
            if (typeof value === "object") {
                return (
                    value.trace_id ||
                    value.span_id ||
                    value?.node?.trace_id ||
                    value?.node?.id ||
                    null
                )
            }
            return null
        }

        if (!nodes) return undefined
        if (Array.isArray(nodes)) {
            return extractTraceId(nodes)
        }

        for (const value of Object.values(nodes)) {
            const found = extractTraceId(value)
            if (found) return found
        }

        return undefined
    }, [result])

    const handleOpen = useCallback(() => {
        if (!traceId) return

        const deriveActiveSpan = (): string | null => {
            const nodes = (result as any)?.response?.tree?.nodes
            if (!nodes) return null

            const pickSpan = (node: any) => node?.span_id || node?.trace_id || null

            if (Array.isArray(nodes)) {
                return pickSpan(nodes[0])
            }

            const first = Object.values(nodes)[0]
            if (Array.isArray(first)) {
                return pickSpan(first[0])
            }

            return pickSpan(first)
        }

        const nextActiveSpan = deriveActiveSpan()
        openTraceDrawer({traceId, activeSpanId: nextActiveSpan})
        setActiveSpan(nextActiveSpan)
        setTraceQueryParam(traceId, {shallow: true})
        if (nextActiveSpan) {
            setSpanQueryParam(nextActiveSpan, {shallow: true})
        } else {
            setSpanQueryParam(undefined, {shallow: true})
        }
    }, [traceId, result, openTraceDrawer, setActiveSpan, setTraceQueryParam, setSpanQueryParam])

    const hasTrace = useMemo(() => {
        const nodes = (result as any)?.response?.tree?.nodes
        const hasNodes = (() => {
            if (!nodes) return false
            if (Array.isArray(nodes)) {
                return nodes.length > 0
            }
            if (typeof nodes === "object") {
                return Object.values(nodes).some((value) => {
                    if (!value) return false
                    if (Array.isArray(value)) {
                        return value.length > 0
                    }
                    if (typeof value === "object") {
                        return Object.keys(value).length > 0
                    }
                    return false
                })
            }
            return false
        })()

        return hasNodes || Boolean(result?.response?.trace) || Boolean(result?.error)
    }, [result])

    const passthroughProps = {
        "data-ivt-stop-row-click": true,
    }

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as React.ReactElement<{onClick: () => void; loading?: boolean}>,
                    {
                        onClick: handleOpen,
                        ...passthroughProps,
                    },
                )
            ) : (
                <Button
                    type="text"
                    icon={icon && <TreeView size={14} />}
                    onClick={handleOpen}
                    {...passthroughProps}
                    {...props}
                    disabled={!hasTrace || !traceId}
                    className={clsx([props.className])}
                >
                    {label}
                </Button>
            )}
        </>
    )
}

export default TraceDrawerButton
export {default as TraceDrawer} from "./components/TraceDrawer"
