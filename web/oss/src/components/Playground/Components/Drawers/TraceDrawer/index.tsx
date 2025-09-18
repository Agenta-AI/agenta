import {cloneElement, isValidElement, useCallback} from "react"

import {TreeView} from "@phosphor-icons/react"
import {Button} from "antd"
import clsx from "clsx"
import {getDefaultStore, useSetAtom} from "jotai"

import {openTraceDrawerAtom} from "./store/traceDrawerStore"
import {TraceDrawerButtonProps} from "./types"

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

    const handleOpen = useCallback(() => {
        const nodes = (result as any)?.response?.tree?.nodes
        const first = Array.isArray(nodes) ? nodes[0] : undefined
        // Support both flattened and nested shapes
        const nodeId =
            (first as any)?.node?.id ||
            (first as any)?.id ||
            (first as any)?.trace_id ||
            (first as any)?.traceId ||
            undefined
        const payload =
            navigationIds !== undefined
                ? {...(result as any), navigationIds, activeTraceId: nodeId}
                : {...(result as any), activeTraceId: nodeId}
        openDrawer({result: payload})
    }, [openDrawer, result, navigationIds])

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
