/**
 * BooleanToggleControl
 *
 * Schema-driven toggle switch for boolean values.
 * Uses a horizontal layout: label left, switch right.
 */

import {memo} from "react"

import type {SchemaProperty} from "@agenta/entities"
import {cn, textColors} from "@agenta/ui/styles"
import {InfoCircleOutlined} from "@ant-design/icons"
import {Switch, Tooltip, Typography} from "antd"

const {Text} = Typography

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

    return (
        <div className={cn("flex items-center justify-between gap-3", className)}>
            <div className="flex items-center gap-1">
                {label && (
                    <Text className={cn("font-medium text-xs", textColors.primary)}>{label}</Text>
                )}
                {showTooltipIcon && (
                    <Tooltip title={tooltipText} placement="right">
                        <InfoCircleOutlined
                            className="text-gray-400 text-[11px] cursor-help"
                            aria-hidden="true"
                        />
                    </Tooltip>
                )}
            </div>
            <Switch
                disabled={disabled}
                checked={checked}
                onChange={onChange}
                size="small"
                className="flex-shrink-0"
            />
        </div>
    )
})
