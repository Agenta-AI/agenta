/**
 * BooleanToggleControl
 *
 * Schema-driven toggle switch for boolean values.
 * Used for stream, json mode, and other boolean flags.
 */

import {memo} from "react"

import {Switch, Tooltip, Typography} from "antd"
import clsx from "clsx"

import type {SchemaProperty} from "../../../shared"

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
    const tooltipText = description ?? (schema as any)?.description ?? ""

    // Normalize value (treat null/undefined as false)
    const checked = value ?? false

    const content = (
        <div className={clsx("flex items-center justify-between gap-2", className)}>
            <Typography.Text className="text-sm font-medium">{label}</Typography.Text>
            <Switch disabled={disabled} checked={checked} onChange={onChange} size="small" />
        </div>
    )

    if (withTooltip && tooltipText) {
        return (
            <Tooltip title={tooltipText} placement="right">
                {content}
            </Tooltip>
        )
    }

    return content
})
