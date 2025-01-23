import {Button, type ButtonProps} from "antd"
import {Play, XCircle} from "@phosphor-icons/react"

interface AddButtonProps extends ButtonProps {
    isRerun?: boolean
    isCancel?: boolean
    isRunAll?: boolean
}

const RunButton = ({
    isRerun = false,
    isCancel = false,
    isRunAll = false,
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
            {isRerun ? "Re run" : isCancel ? "Cancel" : isRunAll ? "Run all" : "Run"}
        </Button>
    )
}

export default RunButton
