/**
 * Section Primitives
 *
 * Reusable layout components for building consistent section layouts.
 * Commonly used in configuration views, detail panels, and card layouts.
 *
 * @example
 * ```tsx
 * import { SectionCard, SectionLabel, SectionHeaderRow, ConfigBlock } from '@agenta/ui'
 *
 * <SectionCard>
 *   <SectionHeaderRow
 *     left={<SectionLabel>Configuration</SectionLabel>}
 *     right={<Button>Edit</Button>}
 *   />
 *   <ConfigBlock title="Settings">
 *     <Input />
 *   </ConfigBlock>
 * </SectionCard>
 * ```
 */

import type {CSSProperties, PropsWithChildren, ReactNode} from "react"

import {Skeleton, Typography} from "antd"

import {cn} from "../../../utils/styles"

const {Text} = Typography

// ============================================================================
// TYPES
// ============================================================================

export interface SectionCardProps {
    /**
     * Additional CSS class
     */
    className?: string
    /**
     * Inline styles
     */
    style?: CSSProperties
    /**
     * Card content
     */
    children: ReactNode
}

export interface SectionHeaderRowProps {
    /**
     * Left side content (typically a label or title)
     */
    left: ReactNode
    /**
     * Right side content (typically actions or buttons)
     */
    right?: ReactNode
    /**
     * Vertical alignment
     * @default "center"
     */
    align?: "start" | "center"
}

export interface SectionLabelProps {
    /**
     * Label text
     */
    children: ReactNode
    /**
     * Additional CSS class
     */
    className?: string
}

export interface ConfigBlockProps {
    /**
     * Block title
     */
    title: ReactNode
    /**
     * Block content
     */
    children: ReactNode
    /**
     * Additional CSS class
     */
    className?: string
}

export interface SectionSkeletonProps {
    /**
     * Number of skeleton lines
     * @default 4
     */
    lines?: number
}

// ============================================================================
// COMPONENTS
// ============================================================================

/**
 * A card container for section content with consistent border and padding
 */
export function SectionCard({children, className, style}: SectionCardProps) {
    return (
        <div
            className={cn(
                "flex flex-col gap-6 border border-solid border-gray-200 bg-white p-4 rounded",
                className,
            )}
            style={style}
        >
            {children}
        </div>
    )
}

/**
 * A header row with left and right content areas
 */
export function SectionHeaderRow({left, right, align = "center"}: SectionHeaderRowProps) {
    return (
        <div
            className={cn(
                "flex justify-between gap-2",
                align === "start" ? "items-start" : "items-center",
            )}
        >
            <div className="flex flex-wrap items-center gap-2 min-w-0">{left}</div>
            {right ?? null}
        </div>
    )
}

/**
 * An uppercase secondary label for section titles
 */
export function SectionLabel({children, className}: SectionLabelProps) {
    return (
        <Text type="secondary" className={cn("uppercase font-semibold text-xs", className)}>
            {children}
        </Text>
    )
}

/**
 * A configuration block with a title and content
 */
export function ConfigBlock({title, children, className}: PropsWithChildren<ConfigBlockProps>) {
    return (
        <div className={cn("flex flex-col gap-2", className)}>
            <SectionLabel>{title}</SectionLabel>
            {children}
        </div>
    )
}

/**
 * A skeleton placeholder for loading section content
 */
export function SectionSkeleton({lines = 4}: SectionSkeletonProps) {
    return (
        <SectionCard>
            <Skeleton active paragraph={{rows: lines}} title={false} />
        </SectionCard>
    )
}
