import React from "react"

import AddButton from "@/oss/components/Playground/assets/AddButton"
import RunButton from "@/oss/components/Playground/assets/RunButton"

interface Props {
    isRunning?: boolean
    onRun: () => void
    onCancel: () => void
    onAddMessage: () => void
}

const ControlsBar: React.FC<Props> = ({isRunning, onRun, onCancel, onAddMessage}) => {
    return (
        <div className="flex items-center gap-2">
            {!isRunning ? (
                <RunButton onClick={onRun} size="small" />
            ) : (
                <RunButton isCancel onClick={onCancel} size="small" />
            )}
            <AddButton
                size="small"
                label="Message"
                onClick={onAddMessage}
                disabled={Boolean(isRunning)}
            />
        </div>
    )
}

export default ControlsBar
