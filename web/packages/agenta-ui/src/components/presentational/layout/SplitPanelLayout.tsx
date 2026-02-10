/**
 * SplitPanelLayout Component
 *
 * A two-column split panel layout with optional divider.
 * Commonly used in modals for picker + preview or form + preview layouts.
 *
 * @example
 * ```tsx
 * import { SplitPanelLayout } from '@agenta/ui'
 *
 * <SplitPanelLayout
 *   leftWidth={280}
 *   left={<Navigation />}
 *   right={<Content />}
 * />
 * ```
 */

import type {CSSProperties, ReactNode} from "react"

import {Divider} from "antd"

import {cn, flexLayouts, gapClasses, layoutSizes, spacingClasses} from "../../../utils/styles"

// ============================================================================
// TYPES
// ============================================================================

export interface SplitPanelLayoutProps {
    /**
     * Left panel content
     */
    left: ReactNode
    /**
     * Right panel content
     */
    right: ReactNode
    /**
     * Width of the left panel in pixels
     * @default 280
     */
    leftWidth?: number
    /**
     * Whether to show a divider between panels
     * @default true
     */
    showDivider?: boolean
    /**
     * Additional CSS class for the container
     */
    className?: string
    /**
     * Inline styles for the container
     */
    style?: CSSProperties
    /**
     * Padding for the left panel
     * @default "p-4"
     */
    leftPadding?: string
    /**
     * Padding for the right panel
     * @default "p-4"
     */
    rightPadding?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

export function SplitPanelLayout({
    left,
    right,
    leftWidth = layoutSizes.sidebarNarrow,
    showDivider = true,
    className,
    style,
    leftPadding = spacingClasses.panel,
    rightPadding = spacingClasses.panel,
}: SplitPanelLayoutProps) {
    return (
        <section
            className={cn(flexLayouts.rowGrow, "min-h-0 overflow-hidden", className)}
            style={style}
        >
            {/* Left Panel */}
            <div
                className={cn(
                    flexLayouts.column,
                    "min-h-0 h-full overflow-hidden",
                    gapClasses.lg,
                    leftPadding,
                )}
                style={{
                    width: leftWidth,
                    minWidth: leftWidth,
                    maxWidth: leftWidth,
                }}
            >
                {left}
            </div>

            {showDivider && <Divider type="vertical" className="m-0 h-full" />}

            {/* Right Panel */}
            <div
                className={cn(
                    flexLayouts.column,
                    "w-full h-full grow min-h-0 overflow-hidden",
                    gapClasses.lg,
                    rightPadding,
                )}
            >
                {right}
            </div>
        </section>
    )
}
