/**
 * LabeledField Component
 *
 * A wrapper component that adds a label and optional tooltip to form controls.
 * Provides consistent styling for labeled form fields across the application.
 *
 * @example
 * ```tsx
 * import { LabeledField, SliderInput } from '@agenta/ui'
 *
 * <LabeledField label="Temperature" description="Controls randomness">
 *   <SliderInput value={0.7} onChange={setTemp} min={0} max={2} />
 * </LabeledField>
 * ```
 */

import type {ReactNode} from "react"

import {Tooltip, Typography} from "antd"

import {cn} from "../../../utils/styles"

const {Text} = Typography

// ============================================================================
// TYPES
// ============================================================================

export interface LabeledFieldProps {
    /** Display label */
    label?: string
    /** Tooltip description */
    description?: string
    /** Whether to show tooltip on label */
    withTooltip?: boolean
    /** Tooltip placement */
    tooltipPlacement?: "top" | "right" | "bottom" | "left"
    /** Label size variant */
    size?: "xs" | "sm" | "md"
    /** Layout direction */
    direction?: "vertical" | "horizontal"
    /** Children (the actual control) */
    children: ReactNode
    /** Additional CSS classes */
    className?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * A wrapper component that provides consistent label and tooltip styling
 * for form controls.
 */
export function LabeledField({
    label,
    description,
    withTooltip = true,
    tooltipPlacement = "right",
    size = "sm",
    direction = "vertical",
    children,
    className,
}: LabeledFieldProps) {
    const sizeClasses = {
        xs: "text-xs",
        sm: "text-sm",
        md: "text-base",
    }

    const content = (
        <div
            className={cn(
                direction === "vertical" ? "flex flex-col gap-1" : "flex items-center gap-2",
                className,
            )}
        >
            {label && (
                <Text className={cn("font-medium text-zinc-9", sizeClasses[size])}>{label}</Text>
            )}
            {children}
        </div>
    )

    if (withTooltip && description && label) {
        return (
            <Tooltip title={description} placement={tooltipPlacement}>
                {content}
            </Tooltip>
        )
    }

    return content
}

export default LabeledField
