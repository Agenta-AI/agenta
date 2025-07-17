import {Play, XCircle} from "@phosphor-icons/react"
import {Button, type ButtonProps} from "antd"

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
    return (
        <Button
            color={isCancel ? "danger" : "default"}
            icon={isCancel ? <XCircle size={14} /> : <Play size={14} />}
            className="self-start"
            size="small"
            {...props}
        >
            {isRerun ? "Re run" : isCancel ? "Cancel" : isRunAll ? "Run all" : label || "Run"}
        </Button>
    )
}

export default RunButton
