/**
 * ModalContentLayout Component
 *
 * A layout component for modals with a picker/navigation panel on the left,
 * main content on the right, and an optional footer. Uses SplitPanelLayout
 * internally for consistent styling.
 *
 * Common use cases:
 * - Entity selection modals (testset picker + table preview)
 * - Configuration modals (navigation + settings)
 * - Wizard-style modals (steps + content)
 *
 * @example
 * ```tsx
 * import { ModalContentLayout } from '@agenta/ui'
 *
 * <ModalContentLayout
 *   picker={<TestsetPicker ... />}
 *   content={<TestcaseTable ... />}
 *   footer={<SelectionSummary ... />}
 *   pickerWidth={320}
 * />
 * ```
 */

import type {ReactNode} from "react"

import {cn, flexLayouts, layoutSizes, spacingClasses} from "../../../utils/styles"

import {PanelFooter} from "./PanelFooter"
import {SplitPanelLayout} from "./SplitPanelLayout"

// ============================================================================
// TYPES
// ============================================================================

export interface ModalContentLayoutProps {
    /**
     * Left panel content (picker, navigation, steps)
     */
    picker: ReactNode
    /**
     * Main content area (table, form, preview)
     */
    content: ReactNode
    /**
     * Optional footer content (buttons, summary)
     * Rendered below the split layout with a top border
     */
    footer?: ReactNode
    /**
     * Width of the picker panel in pixels
     * @default 320
     */
    pickerWidth?: number
    /**
     * Additional CSS class for the container
     */
    className?: string
    /**
     * Padding for the picker panel
     * @default "p-4"
     */
    pickerPadding?: string
    /**
     * Padding for the content panel
     * @default "p-4"
     */
    contentPadding?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ModalContentLayout({
    picker,
    content,
    footer,
    pickerWidth = layoutSizes.sidebarWide,
    className,
    pickerPadding = spacingClasses.panel,
    contentPadding = spacingClasses.panel,
}: ModalContentLayoutProps) {
    return (
        <div className={cn(flexLayouts.column, "h-full", className)}>
            {/* Main content - left/right layout */}
            <SplitPanelLayout
                leftWidth={pickerWidth}
                left={picker}
                right={content}
                leftPadding={pickerPadding}
                rightPadding={contentPadding}
            />

            {/* Footer - optional, with top border */}
            {footer && <PanelFooter align="between">{footer}</PanelFooter>}
        </div>
    )
}
