import React, {useCallback} from "react"

import {recordWidgetEventAtom} from "@agenta/onboarding/state"
import {AddButton, RunButton} from "@agenta/ui/components/presentational"
import clsx from "clsx"
import {useSetAtom} from "jotai"

interface ControlsBarProps {
    isRunning?: boolean
    onRun: () => void
    onCancel: () => void
    onAddMessage: () => void
    className?: string
}

const ControlsBar: React.FC<ControlsBarProps> = ({
    isRunning,
    onRun,
    onCancel,
    onAddMessage,
    className,
}) => {
    // Onboarding event is fired here directly (the component owns its own "ran a prompt"
    // signal) instead of being injected by an app wrapper via a callback prop. Reads from
    // @agenta/onboarding/state so the playground-ui package no longer needs the app to bridge it.
    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)
    const onTrackRun = useCallback(() => {
        recordWidgetEvent("playground_ran_prompt")
    }, [recordWidgetEvent])

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
