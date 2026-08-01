import React from "react"

import {RunButton, type RunButtonProps} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"
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
                    size="sm"
                    data-tour="run-button"
                    onTrackRun={onTrackRun}
                />
            ) : (
                <RunButton mode="cancel" onClick={onCancel} size="sm" />
            )}
            <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={onAddMessage}
                disabled={Boolean(isRunning)}
            >
                <Plus size={14} />
                Message
            </Button>
        </div>
    )
}

export default ControlsBar
export type {ControlsBarProps}
