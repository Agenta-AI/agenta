import React from "react"

import {AddButton, RunButton, type RunButtonProps} from "@agenta/ui/components/presentational"
import clsx from "clsx"

interface ControlsBarProps {
    isRunning?: boolean
    onRun: () => void
    onCancel: () => void
    onAddMessage: () => void
    onTrackRun?: RunButtonProps["onTrackRun"]
    className?: string
}

const ControlsBar: React.FC<ControlsBarProps> = ({
    isRunning,
    onRun,
    onCancel,
    onAddMessage,
    onTrackRun,
    className,
}) => {
    return (
        <div className={clsx("flex items-center gap-2", className)}>
            {!isRunning ? (
                <RunButton
                    onClick={onRun}
                    size="small"
                    data-tour="run-button"
                    onTrackRun={onTrackRun}
                />
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
export type {ControlsBarProps}
