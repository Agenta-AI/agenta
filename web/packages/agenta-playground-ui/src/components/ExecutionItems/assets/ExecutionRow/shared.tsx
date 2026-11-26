import React from "react"

import {DropdownButton} from "@agenta/ui/components"
import type {DropdownButtonOption} from "@agenta/ui/components"
import {RunButton} from "@agenta/ui/components/presentational"
import {PlayIcon} from "@phosphor-icons/react"

interface ExecutionRowRunControlProps {
    showDropdown: boolean
    stepOptions: DropdownButtonOption[]
    isBusy: boolean
    isRunning?: boolean
    runningStepLabel?: string | null
    runLabel?: React.ReactNode
    onRun: () => void
    onCancel: () => void
    onOptionSelect: (key: string) => void
    trigger?: ("click" | "hover" | "contextMenu")[]
    className?: string
    dataTour?: string
}

export const ExecutionRowRunControl = ({
    showDropdown,
    stepOptions,
    isBusy,
    isRunning = false,
    runningStepLabel,
    runLabel = "Run",
    onRun,
    onCancel,
    onOptionSelect,
    trigger,
    className = "flex",
    dataTour,
}: ExecutionRowRunControlProps) => {
    if (showDropdown && stepOptions.length > 0) {
        return (
            <DropdownButton
                label={
                    isBusy
                        ? runningStepLabel
                            ? `Running ${runningStepLabel}...`
                            : "Running..."
                        : runLabel
                }
                icon={<PlayIcon size={14} />}
                size="sm"
                options={stepOptions}
                onClick={isBusy ? onCancel : onRun}
                onOptionSelect={onOptionSelect}
                loading={isBusy}
                trigger={trigger}
            />
        )
    }

    if (isBusy) {
        return <RunButton mode="cancel" onClick={onCancel} className={className} />
    }

    return (
        <RunButton
            onClick={onRun}
            disabled={isRunning}
            className={className}
            data-tour={dataTour}
        />
    )
}
