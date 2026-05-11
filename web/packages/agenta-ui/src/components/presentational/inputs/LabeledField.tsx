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

import {InfoCircleOutlined} from "@ant-design/icons"
import {Tooltip, Typography} from "antd"

import {cn, flexLayouts, gapClasses, textColors, textSizes} from "../../../utils/styles"

const {Text} = Typography

// ============================================================================
// TYPES
// ============================================================================

export interface LabeledFieldProps {
    /** Display label */
    label?: string
    /** Tooltip description */
    description?: string
    /** Whether to show tooltip */
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
    size = "xs",
    direction = "vertical",
    children,
    className,
}: LabeledFieldProps) {
    const sizeClassMap = {
        xs: textSizes.xs,
        sm: textSizes.sm,
        md: textSizes.base,
    }

    const isHorizontal = direction === "horizontal"
    const showTooltipIcon = withTooltip && !!description && !!label

    return (
        <div
            className={cn(
                direction === "vertical"
                    ? cn(flexLayouts.column, gapClasses.xs)
                    : cn(flexLayouts.rowCenter, gapClasses.sm),
                className,
            )}
        >
            {label && (
                <div className="flex items-center gap-1">
                    <Text
                        className={cn(
                            "font-medium",
                            textColors.primary,
                            sizeClassMap[size],
                            isHorizontal && "flex-shrink-0",
                        )}
                    >
                        {label}
                    </Text>
                    {showTooltipIcon && (
                        <Tooltip title={description} placement={tooltipPlacement}>
                            <InfoCircleOutlined
                                className="text-gray-400 text-[11px] cursor-help"
                                aria-hidden="true"
                            />
                        </Tooltip>
                    )}
                </div>
            )}
            {isHorizontal ? <div className="flex-1 min-w-0">{children}</div> : children}
        </div>
    )
}

export default LabeledField
