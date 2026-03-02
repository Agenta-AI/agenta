/**
 * EntityListItemLabel Component
 *
 * A reusable label component for entity list items in dropdowns and select menus.
 * Displays a primary label with optional subtitle, icon, and metadata.
 *
 * Text size inherits from parent context (e.g., Ant Design Select dropdown).
 * This follows the pattern used by other presentational components like RevisionLabel.
 *
 * @example
 * ```tsx
 * import {EntityListItemLabel} from '@agenta/ui'
 *
 * // Simple label
 * <EntityListItemLabel label="My App" />
 *
 * // With subtitle
 * <EntityListItemLabel label="My App" subtitle="prompt" />
 *
 * // With icon and metadata
 * <EntityListItemLabel
 *   label="My Variant"
 *   subtitle="from default"
 *   icon={<GitBranch size={14} />}
 *   trailing={<VersionBadge version={3} />}
 * />
 * ```
 */

import type {ReactNode} from "react"

import {cn, flexLayouts, textColors} from "../../../utils/styles"

// ============================================================================
// TYPES
// ============================================================================

export interface EntityListItemLabelProps {
    /**
     * Primary label text
     */
    label: string

    /**
     * Secondary/subtitle text (displayed below or beside the label)
     */
    subtitle?: string | null

    /**
     * Optional leading icon
     */
    icon?: ReactNode

    /**
     * Optional trailing element (badge, version, status, etc.)
     */
    trailing?: ReactNode

    /**
     * Layout direction for subtitle
     * @default "column"
     */
    layout?: "column" | "inline"

    /**
     * Whether to capitalize the subtitle
     * @default false
     */
    capitalizeSubtitle?: boolean

    /**
     * Maximum width for label truncation
     */
    maxLabelWidth?: number

    /**
     * Reserve space for subtitle even when not provided.
     * Use this to maintain consistent height between items with and without subtitles.
     * @default false
     */
    reserveSubtitleSpace?: boolean

    /**
     * Additional CSS class
     */
    className?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Entity list item label for dropdowns and select menus
 *
 * Provides consistent styling for entity selection items with support for:
 * - Primary label with optional truncation (inherits text size from parent)
 * - Subtitle text (e.g., type, base name, metadata) in muted color
 * - Leading icon
 * - Trailing element (badge, version, status)
 */
export function EntityListItemLabel({
    label,
    subtitle,
    icon,
    trailing,
    layout = "column",
    capitalizeSubtitle = false,
    maxLabelWidth,
    reserveSubtitleSpace = false,
    className,
}: EntityListItemLabelProps) {
    const isInline = layout === "inline"

    // Determine if we need the full structure (with potential subtitle space)
    const needsFullStructure = subtitle || icon || trailing || reserveSubtitleSpace

    // If no subtitle, icon, trailing, or reserved space - just return the label text
    if (!needsFullStructure) {
        return (
            <span
                className={cn("truncate", className)}
                style={maxLabelWidth ? {maxWidth: maxLabelWidth} : undefined}
                title={label}
            >
                {label}
            </span>
        )
    }

    const labelElement = (
        <span
            className="truncate"
            style={maxLabelWidth ? {maxWidth: maxLabelWidth} : undefined}
            title={label}
        >
            {label}
        </span>
    )

    // Subtitle element - show actual subtitle or invisible spacer for consistent height
    const subtitleElement = subtitle ? (
        <span
            className={cn(
                textColors.muted,
                capitalizeSubtitle && "capitalize",
                isInline && "ml-1.5",
            )}
        >
            {subtitle}
        </span>
    ) : reserveSubtitleSpace ? (
        // Invisible spacer to maintain consistent height
        <span className={cn(textColors.muted, "invisible", isInline && "ml-1.5")}>&nbsp;</span>
    ) : null

    // Content layout (label + subtitle)
    const contentElement = isInline ? (
        <span className={cn(flexLayouts.inlineCenter, "gap-0")}>
            {labelElement}
            {subtitleElement}
        </span>
    ) : (
        <div className={cn(flexLayouts.column, "gap-0 min-w-0")}>
            {labelElement}
            {subtitleElement}
        </div>
    )

    // If we have icon or trailing, wrap in a row
    if (icon || trailing) {
        return (
            <div className={cn(flexLayouts.rowCenter, "gap-2 min-w-0", className)}>
                {icon && <span className={cn(textColors.muted, "flex-shrink-0")}>{icon}</span>}
                <div className="flex-1 min-w-0">{contentElement}</div>
                {trailing && <span className="flex-shrink-0">{trailing}</span>}
            </div>
        )
    }

    return <div className={cn("min-w-0", className)}>{contentElement}</div>
}

// ============================================================================
// PRESETS
// ============================================================================

/**
 * Preset for app list items
 */
export function AppListItemLabel({
    name,
    appType,
    reserveSubtitleSpace,
    className,
}: {
    name: string
    appType?: string | null
    /** Reserve space for app type subtitle even when not provided */
    reserveSubtitleSpace?: boolean
    className?: string
}) {
    // Filter out legacy custom SDK type
    const displayType = appType && appType !== "custom (sdk)" ? appType : undefined

    return (
        <EntityListItemLabel
            label={name}
            subtitle={displayType}
            capitalizeSubtitle
            reserveSubtitleSpace={reserveSubtitleSpace}
            className={className}
        />
    )
}

/**
 * Preset for variant list items
 */
export function VariantListItemLabel({
    name,
    baseName,
    reserveSubtitleSpace,
    className,
}: {
    name: string
    baseName?: string | null
    /** Reserve space for base name subtitle even when not provided */
    reserveSubtitleSpace?: boolean
    className?: string
}) {
    // Only show base name if different from variant name
    const subtitle = baseName && baseName !== name ? `from ${baseName}` : undefined

    return (
        <EntityListItemLabel
            label={name}
            subtitle={subtitle}
            reserveSubtitleSpace={reserveSubtitleSpace}
            className={className}
        />
    )
}
