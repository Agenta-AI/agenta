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

import type {ComponentPropsWithoutRef, MouseEvent} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {PlayIcon, XCircleIcon} from "@phosphor-icons/react"

// ============================================================================
// TYPES
// ============================================================================

export interface RunButtonProps extends ComponentPropsWithoutRef<typeof Button> {
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
    const {onClick, variant, className, size, ...restProps} = props
    const handleClick = (event: MouseEvent<HTMLElement>) => {
        if (!isCancel) {
            onTrackRun?.()
        }
        onClick?.(event)
    }

    return (
        <Button
            variant={isCancel ? "destructive" : variant}
            className={["self-start", className].filter(Boolean).join(" ")}
            size={size ?? "sm"}
            onClick={handleClick}
            {...restProps}
        >
            {isCancel ? <XCircleIcon size={14} /> : <PlayIcon size={14} />}
            {isRerun ? "Re run" : isCancel ? "Cancel" : isRunAll ? "Run all" : label || "Run"}
        </Button>
    )
}

export default RunButton
