/**
 * BooleanToggleControl
 *
 * Schema-driven toggle switch for boolean values.
 * Uses a horizontal layout: label left, switch right.
 */

import {memo, useId} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import {cn, textColors} from "@agenta/ui/styles"
import {Switch, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"
import {Info} from "@phosphor-icons/react"

export interface BooleanToggleControlProps {
    /** The schema property (used for description) */
    schema?: SchemaProperty | null
    /** Display label for the control */
    label: string
    /** Current value */
    value: boolean | null | undefined
    /** Change handler */
    onChange: (value: boolean) => void
    /** Optional description for tooltip */
    description?: string
    /** Whether to show tooltip */
    withTooltip?: boolean
    /** Disable the control */
    disabled?: boolean
    /** Additional CSS classes */
    className?: string
}

/**
 * A controlled toggle switch for boolean properties.
 *
 * Uses schema for:
 * - Description for tooltip
 * - Default value (if provided)
 */
export const BooleanToggleControl = memo(function BooleanToggleControl({
    schema,
    label,
    value,
    onChange,
    description,
    withTooltip = true,
    disabled = false,
    className,
}: BooleanToggleControlProps) {
    // Get description from schema or prop
    const tooltipText = description ?? (schema?.description as string | undefined) ?? ""

    // Normalize value (treat null/undefined as false)
    const checked = value ?? false
    const showTooltipIcon = withTooltip && !!tooltipText && !!label
    // Names the Switch from the adjacent visible label (axe button-name).
    const labelId = useId()

    return (
        <div className={cn("flex items-center justify-between gap-3", className)}>
            <div className="flex items-center gap-1">
                {label && (
                    <span id={labelId} className={cn("font-medium text-xs", textColors.primary)}>
                        {label}
                    </span>
                )}
                {showTooltipIcon && (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Info size={12} className="text-gray-400 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="right">{tooltipText}</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}
            </div>
            <Switch
                disabled={disabled}
                checked={checked}
                onCheckedChange={onChange}
                size="sm"
                aria-labelledby={label ? labelId : undefined}
                aria-label={label ? undefined : "Toggle"}
                className="flex-shrink-0"
            />
        </div>
    )
})
