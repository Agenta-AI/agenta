import {cloneElement, isValidElement, useCallback, useMemo} from "react"

import {traceDrawerSetQueryParam} from "@agenta/observability/traceDrawer"
import {openTraceDrawerAtom, setTraceDrawerActiveSpanAtom} from "@agenta/observability/traceDrawer"
import {EnhancedButton} from "@agenta/ui/components/presentational"
import {TreeView} from "@phosphor-icons/react"
import clsx from "clsx"
import {useSetAtom} from "jotai"

import {TraceDrawerButtonProps} from "./traceDrawerButtonTypes"

const TraceDrawerButton = ({
    label,
    icon = true,
    children,
    result,
    ...props
}: TraceDrawerButtonProps) => {
    // A playground test result; probed rather than typed since playground sits above this package.
    const loose = result as
        | {
              response?: {
                  trace_id?: string
                  trace?: {trace_id?: string}
                  tree?: {nodes?: unknown}
              }
              metadata?: {rawError?: {detail?: {trace_id?: string}}}
              error?: unknown
          }
        | null
        | undefined

    const setActiveSpan = useSetAtom(setTraceDrawerActiveSpanAtom)
    const openTraceDrawer = useSetAtom(openTraceDrawerAtom)

    const traceId = useMemo(() => {
        const directTraceId =
            loose?.response?.trace_id || loose?.metadata?.rawError?.detail?.trace_id
        if (directTraceId) return directTraceId

        const responseTrace = loose?.response?.trace
        if (responseTrace?.trace_id) return responseTrace.trace_id

        const nodes = loose?.response?.tree?.nodes
        const extractTraceId = (value: unknown): string | null => {
            if (!value) return null
            if (Array.isArray(value)) {
                for (const entry of value) {
                    const found = extractTraceId(entry)
                    if (found) return found
                }
                return null
            }
            if (typeof value === "object") {
                const node = value as {
                    trace_id?: string
                    span_id?: string
                    node?: {trace_id?: string; id?: string}
                }
                return node.trace_id || node.span_id || node.node?.trace_id || node.node?.id || null
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
            const nodes = loose?.response?.tree?.nodes
            if (!nodes) return null

            const pickSpan = (node: unknown) => {
                const n = node as {span_id?: string; trace_id?: string} | null | undefined
                return n?.span_id || n?.trace_id || null
            }

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
        // Batch trace and span into a single navigation command to avoid
        // a race where the second patch overwrites the first, and preserve
        // the URL hash so the playground snapshot is not lost.
        // Was a `patch-query` navigation request; the seam writes the same two params shallow.
        traceDrawerSetQueryParam("trace", traceId)
        traceDrawerSetQueryParam("span", nextActiveSpan ?? undefined)
    }, [traceId, result, openTraceDrawer, setActiveSpan])

    const hasTrace = useMemo(() => {
        const nodes = loose?.response?.tree?.nodes
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

        return hasNodes || Boolean(loose?.response?.trace) || Boolean(loose?.error)
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
                <EnhancedButton
                    type="text"
                    icon={icon && <TreeView size={14} />}
                    onClick={handleOpen}
                    {...passthroughProps}
                    {...props}
                    disabled={!hasTrace || !traceId}
                    className={clsx([props.className])}
                >
                    {label}
                </EnhancedButton>
            )}
        </>
    )
}

export default TraceDrawerButton
