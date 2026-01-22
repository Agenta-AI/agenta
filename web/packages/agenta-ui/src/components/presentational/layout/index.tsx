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

import type {CSSProperties, ReactNode} from "react"

import {Divider, Typography} from "antd"

import {borderColors, textColors} from "../../../utils/styles"

const {Text} = Typography

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
     * @default "gap-4"
     */
    gap?: string
    /**
     * Additional CSS class
     */
    className?: string
}

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
// COMPONENTS
// ============================================================================

/**
 * A two-column split panel layout with optional divider.
 * Commonly used in modals for picker + preview or form + preview layouts.
 */
export function SplitPanelLayout({
    left,
    right,
    leftWidth = 280,
    showDivider = true,
    className,
    style,
    leftPadding = "p-4",
    rightPadding = "p-4",
}: SplitPanelLayoutProps) {
    return (
        <section
            className={`flex grow gap-0 min-h-0 overflow-hidden ${className ?? ""}`}
            style={style}
        >
            {/* Left Panel */}
            <div
                className={`flex flex-col gap-4 min-h-0 h-full overflow-hidden ${leftPadding}`}
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
                className={`w-full h-full flex flex-col gap-4 grow min-h-0 overflow-hidden ${rightPadding}`}
            >
                {right}
            </div>
        </section>
    )
}

/**
 * A numbered step component for wizard-style UIs.
 * Displays a step number, title, optional subtitle, and content in a bordered card.
 */
export function NumberedStep({number, title, subtitle, children, className}: NumberedStepProps) {
    return (
        <div
            className={`flex flex-col gap-3 rounded-lg border ${borderColors.secondary} px-4 py-3 ${className ?? ""}`}
        >
            <div className="flex items-center gap-2">
                <span className={`text-xs font-medium ${textColors.tertiary}`}>{number}.</span>
                <Text className={`font-medium text-sm ${textColors.primary}`}>{title}</Text>
                {subtitle && <Text className={`text-xs ${textColors.tertiary}`}>{subtitle}</Text>}
            </div>
            {children}
        </div>
    )
}

/**
 * A container for numbered steps with consistent spacing.
 */
export function StepContainer({children, gap = "gap-3", className}: StepContainerProps) {
    return <div className={`flex flex-col ${gap} grow ${className ?? ""}`}>{children}</div>
}

/**
 * A footer component for panels/modals with consistent border and alignment.
 */
export function PanelFooter({children, align = "end", className}: PanelFooterProps) {
    const alignClass = {
        start: "justify-start",
        center: "justify-center",
        end: "justify-end",
        between: "justify-between",
    }[align]

    return (
        <div
            className={`border-t ${borderColors.secondary} p-4 flex items-center gap-2 ${alignClass} ${className ?? ""}`}
        >
            {children}
        </div>
    )
}
