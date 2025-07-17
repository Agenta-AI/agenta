import {cloneElement, isValidElement, useCallback} from "react"

import {TreeView} from "@phosphor-icons/react"
import {Button} from "antd"
import clsx from "clsx"

import {traceDrawerJotaiStore, traceDrawerAtom} from "./store/traceDrawerStore"
import {TraceDrawerButtonProps} from "./types"

const TraceDrawerButton = ({
    label,
    icon = true,
    children,
    result,
    ...props
}: TraceDrawerButtonProps) => {
    const handleOpen = useCallback(() => {
        traceDrawerJotaiStore.set(traceDrawerAtom, {open: true, result})
    }, [])

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
