/**
 * MetadataHeader Component
 *
 * A header component for displaying metadata information with a label and value.
 * Used for tool response messages, function names, and other metadata displays.
 *
 * @example
 * ```tsx
 * import { MetadataHeader } from '@agenta/ui'
 *
 * // Function name and call ID
 * <MetadataHeader
 *   label="get_weather"
 *   labelTooltip="Function name"
 *   value="call_abc123"
 *   valueTooltip="Tool call ID"
 * />
 *
 * // Simple label only
 * <MetadataHeader label="Response" />
 * ```
 */

import React from "react"

import {Tooltip} from "antd"

import {cn, flexLayouts, textColors} from "../../../utils/styles"

// ============================================================================
// TYPES
// ============================================================================

export interface MetadataHeaderProps {
    /**
     * Primary label (e.g., function name)
     */
    label?: string | null
    /**
     * Tooltip for the label
     */
    labelTooltip?: string
    /**
     * Secondary value (e.g., tool call ID)
     */
    value?: string | null
    /**
     * Tooltip for the value
     */
    valueTooltip?: string
    /**
     * Maximum width for value truncation
     * @default 200
     */
    maxValueWidth?: number
    /**
     * Additional CSS class name
     */
    className?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Displays metadata information with a label and optional value.
 * Supports tooltips and truncation for long values.
 */
export function MetadataHeader({
    label,
    labelTooltip,
    value,
    valueTooltip,
    maxValueWidth = 200,
    className,
}: MetadataHeaderProps) {
    if (!label && !value) return null

    return (
        <div
            className={cn(
                "w-full justify-between text-xs px-1 py-1",
                flexLayouts.rowCenter,
                textColors.muted,
                className,
            )}
        >
            {label && (
                <Tooltip title={labelTooltip}>
                    <span className={cn("font-medium", textColors.secondary)}>{label}</span>
                </Tooltip>
            )}
            {value && (
                <Tooltip title={valueTooltip}>
                    <span
                        className={cn("font-mono truncate", textColors.quaternary)}
                        style={{maxWidth: maxValueWidth}}
                    >
                        {value}
                    </span>
                </Tooltip>
            )}
        </div>
    )
}

export default MetadataHeader
