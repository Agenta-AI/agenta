/**
 * RunButton Component
 *
 * A generic run/cancel action button with Play/X icons.
 * Wraps Ant Design Button with consistent styling for execution actions.
 *
 * @example
 * ```tsx
 * import { RunButton } from '@agenta/ui'
 *
 * <RunButton onClick={handleRun} />
 * <RunButton isCancel onClick={handleCancel} />
 * <RunButton isRunAll type="primary" onClick={handleRunAll} />
 * ```
 */

import type {MouseEvent} from "react"

import {PlayIcon, XCircleIcon} from "@phosphor-icons/react"
import {Button, type ButtonProps} from "antd"

// ============================================================================
// TYPES
// ============================================================================

export interface RunButtonProps extends ButtonProps {
    isRerun?: boolean
    isCancel?: boolean
    isRunAll?: boolean
    label?: string
    onTrackRun?: () => void
}

// ============================================================================
// COMPONENT
// ============================================================================

const RunButton = ({
    isRerun = false,
    isCancel = false,
    isRunAll = false,
    label,
    onTrackRun,
    ...props
}: RunButtonProps) => {
    const {onClick, ...restProps} = props
    const handleClick = (event: MouseEvent<HTMLElement>) => {
        if (!isCancel) {
            onTrackRun?.()
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
