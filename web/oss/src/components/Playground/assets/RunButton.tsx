import type {MouseEvent} from "react"

import {PlayIcon, XCircleIcon} from "@phosphor-icons/react"
import {Button, type ButtonProps} from "antd"
import {useSetAtom} from "jotai"

import {recordWidgetEventAtom} from "@/oss/lib/onboarding"

interface AddButtonProps extends ButtonProps {
    isRerun?: boolean
    isCancel?: boolean
    isRunAll?: boolean
    label?: string
}

const RunButton = ({
    isRerun = false,
    isCancel = false,
    isRunAll = false,
    label,
    ...props
}: AddButtonProps) => {
    const {onClick, ...restProps} = props
    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)
    const handleClick = (event: MouseEvent<HTMLElement>) => {
        if (!isCancel) {
            recordWidgetEvent("playground_ran_prompt")
        }
        onClick?.(event)
    }

    return (
        <Button
            color={isCancel ? "danger" : "default"}
            icon={isCancel ? <XCircleIcon size={14} /> : <PlayIcon size={14} />}
            className="self-start"
            size="small"
            onClick={handleClick}
            {...restProps}
        >
            {isRerun ? "Re run" : isCancel ? "Cancel" : isRunAll ? "Run all" : label || "Run"}
        </Button>
    )
}

export default RunButton
