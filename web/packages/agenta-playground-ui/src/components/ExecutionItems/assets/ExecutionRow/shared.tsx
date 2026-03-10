import React, {useCallback, useMemo} from "react"

import {runnableBridge} from "@agenta/entities/runnable"
import type {PlaygroundNode} from "@agenta/entities/runnable"
import {DropdownButton} from "@agenta/ui/components"
import type {DropdownButtonOption} from "@agenta/ui/components"
import {RunButton} from "@agenta/ui/components/presentational"
import {PlayIcon} from "@phosphor-icons/react"
import {atom} from "jotai"
import {useAtomValue} from "jotai"

export const usePlaygroundNodeLabels = (nodes: PlaygroundNode[] | null) => {
    const nodeNamesAtom = useMemo(
        () =>
            atom((get) => {
                if (!nodes) return {} as Record<string, string>
                const names: Record<string, string> = {}
                for (const node of nodes) {
                    const data = get(runnableBridge.dataForType(node.entityType, node.entityId))
                    if (data?.name) {
                        names[node.id] = data.name
                    }
                }
                return names
            }),
        [nodes],
    )
    const nodeNames = useAtomValue(nodeNamesAtom)

    const getNodeLabel = useCallback(
        (node: PlaygroundNode) => {
            const resolvedName = nodeNames[node.id]
            return (
                resolvedName ||
                (node.label && !/^[0-9a-f]{8}-/.test(node.label)
                    ? node.label
                    : node.entityType.charAt(0).toUpperCase() + node.entityType.slice(1))
            )
        },
        [nodeNames],
    )

    return {nodeNames, getNodeLabel}
}

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
                size="small"
                options={stepOptions}
                onClick={isBusy ? onCancel : onRun}
                onOptionSelect={onOptionSelect}
                loading={isBusy}
                trigger={trigger}
            />
        )
    }

    if (isBusy) {
        return <RunButton isCancel onClick={onCancel} className={className} />
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
