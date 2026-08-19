/**
 * Layout Primitives
 *
 * Reusable layout components for building consistent modal and panel layouts.
 * Commonly used in modals, configuration panels, and wizard-style UIs.
 *
 * @example
 * ```tsx
 * import { SplitPanelLayout, NumberedStep } from '@agenta/ui'
 *
 * <SplitPanelLayout
 *   leftWidth={280}
 *   left={
 *     <div className="flex flex-col grow gap-3">
 *       <NumberedStep number={1} title="Name">
 *         <Input />
 *       </NumberedStep>
 *       <NumberedStep number={2} title="Review">
 *         <span>Preview content</span>
 *       </NumberedStep>
 *     </div>
 *   }
 *   right={<TablePreview />}
 * />
 * ```
 */

import type {ReactNode} from "react"

import {
    borderColors,
    cn,
    flexLayouts,
    gapClasses,
    spacingClasses,
    textColors,
    textSizes,
} from "../../../utils/styles"

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
                "rounded-lg border border-solid",
                spacingClasses.card,
                gapClasses.md,
                borderColors.secondary,
                className,
            )}
        >
            <div className={cn(flexLayouts.rowCenter, gapClasses.sm)}>
                <span className={cn("font-medium", textColors.tertiary)}>{number}.</span>
                <span className={cn("font-medium", textSizes.sm, textColors.primary)}>{title}</span>
                {subtitle && <span className={textColors.tertiary}>{subtitle}</span>}
            </div>
            {children}
        </div>
    )
}

// ============================================================================
// RE-EXPORTS
// ============================================================================

export {SplitPanelLayout, type SplitPanelLayoutProps} from "./SplitPanelLayout"
export {ModalContentLayout, type ModalContentLayoutProps} from "./ModalContentLayout"
export {PanelFooter, type PanelFooterProps} from "./PanelFooter"
export {
    PanelSurface,
    PanelScroll,
    PanelSection,
    PANEL_ACTION_CLASS,
    type PanelSectionProps,
} from "./PanelSection"
