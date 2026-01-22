/**
 * PanelFooter Component
 *
 * A footer component for panels/modals with consistent border and alignment.
 *
 * @example
 * ```tsx
 * import { PanelFooter } from '@agenta/ui'
 *
 * <PanelFooter align="between">
 *   <Button>Cancel</Button>
 *   <Button type="primary">Save</Button>
 * </PanelFooter>
 * ```
 */

import type {ReactNode} from "react"

import {
    borderColors,
    cn,
    flexLayouts,
    gapClasses,
    justifyClasses,
    spacingClasses,
} from "../../../utils/styles"

// ============================================================================
// TYPES
// ============================================================================

export interface PanelFooterProps {
    /**
     * Footer content (typically buttons)
     */
    children: ReactNode
    /**
     * Alignment of footer content
     * @default "end"
     */
    align?: "start" | "center" | "end" | "between"
    /**
     * Additional CSS class
     */
    className?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * A footer component for panels/modals with consistent border and alignment.
 */
export function PanelFooter({children, align = "end", className}: PanelFooterProps) {
    return (
        <div
            className={cn(
                "border-t flex-shrink-0",
                flexLayouts.rowCenter,
                spacingClasses.panel,
                gapClasses.sm,
                borderColors.secondary,
                justifyClasses[align],
                className,
            )}
        >
            {children}
        </div>
    )
}
