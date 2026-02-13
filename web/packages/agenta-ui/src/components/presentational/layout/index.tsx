/**
 * Layout Primitives
 *
 * Reusable layout components for building consistent modal and panel layouts.
 * Commonly used in modals, configuration panels, and wizard-style UIs.
 *
 * @example
 * ```tsx
 * import { SplitPanelLayout, NumberedStep, StepContainer } from '@agenta/ui'
 *
 * <SplitPanelLayout
 *   leftWidth={280}
 *   left={
 *     <StepContainer>
 *       <NumberedStep number={1} title="Name">
 *         <Input />
 *       </NumberedStep>
 *       <NumberedStep number={2} title="Review">
 *         <Text>Preview content</Text>
 *       </NumberedStep>
 *     </StepContainer>
 *   }
 *   right={<TablePreview />}
 * />
 * ```
 */

import type {ReactNode} from "react"

import {Typography} from "antd"

import {
    borderColors,
    cn,
    flexLayouts,
    gapClasses,
    spacingClasses,
    textColors,
    textSizes,
} from "../../../utils/styles"

const {Text} = Typography

// ============================================================================
// TYPES
// ============================================================================

export interface NumberedStepProps {
    /**
     * Step number (1, 2, 3, etc.)
     */
    number: number
    /**
     * Step title
     */
    title: ReactNode
    /**
     * Optional subtitle or description
     */
    subtitle?: ReactNode
    /**
     * Step content
     */
    children: ReactNode
    /**
     * Additional CSS class
     */
    className?: string
}

export interface StepContainerProps {
    /**
     * Steps to render
     */
    children: ReactNode
    /**
     * Gap between steps
     * @default gapClasses.md
     */
    gap?: string
    /**
     * Additional CSS class
     */
    className?: string
}

// ============================================================================
// COMPONENTS
// ============================================================================

/**
 * A numbered step component for wizard-style UIs.
 * Displays a step number, title, optional subtitle, and content in a bordered card.
 */
export function NumberedStep({number, title, subtitle, children, className}: NumberedStepProps) {
    return (
        <div
            className={cn(
                flexLayouts.column,
                "rounded-lg border",
                spacingClasses.card,
                gapClasses.md,
                borderColors.secondary,
                className,
            )}
        >
            <div className={cn(flexLayouts.rowCenter, gapClasses.sm)}>
                <span className={cn("font-medium", textColors.tertiary)}>{number}.</span>
                <Text className={cn("font-medium", textSizes.sm, textColors.primary)}>{title}</Text>
                {subtitle && <Text className={textColors.tertiary}>{subtitle}</Text>}
            </div>
            {children}
        </div>
    )
}

/**
 * A container for numbered steps with consistent spacing.
 */
export function StepContainer({children, gap = gapClasses.md, className}: StepContainerProps) {
    return <div className={cn(flexLayouts.column, "grow", gap, className)}>{children}</div>
}

// ============================================================================
// RE-EXPORTS
// ============================================================================

export {SplitPanelLayout, type SplitPanelLayoutProps} from "./SplitPanelLayout"
export {ModalContentLayout, type ModalContentLayoutProps} from "./ModalContentLayout"
export {PanelFooter, type PanelFooterProps} from "./PanelFooter"
