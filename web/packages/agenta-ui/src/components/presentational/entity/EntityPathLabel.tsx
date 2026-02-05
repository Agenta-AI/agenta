/**
 * EntityPathLabel Component
 *
 * Displays hierarchical entity paths like "App / Variant / v1".
 * Used in selection results, breadcrumbs, and entity references.
 *
 * @example
 * ```tsx
 * import {EntityPathLabel} from '@agenta/ui'
 *
 * // Simple path
 * <EntityPathLabel parts={["My App", "default", "v3"]} />
 *
 * // Custom separator
 * <EntityPathLabel parts={["Testset", "v2"]} separator=" → " />
 *
 * // With truncation
 * <EntityPathLabel
 *   parts={["Very Long App Name", "variant", "v1"]}
 *   truncateAt={0}
 *   maxWidth={200}
 * />
 * ```
 */

import React from "react"

import {cn, sizeClasses, flexLayouts, textColors, type SizeVariant} from "../../../utils/styles"

// ============================================================================
// TYPES
// ============================================================================

export interface EntityPathLabelProps {
    /**
     * Path parts to display
     */
    parts: (string | React.ReactNode)[]

    /**
     * Separator between parts
     * @default " / "
     */
    separator?: string | React.ReactNode

    /**
     * Index of part to truncate (for long names)
     * -1 means no truncation
     * @default -1
     */
    truncateAt?: number

    /**
     * Maximum width for truncated part
     * @default 150
     */
    maxWidth?: number

    /**
     * Size variant
     * @default "default"
     */
    size?: SizeVariant

    /**
     * Additional CSS class
     */
    className?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Displays a hierarchical path with configurable separator
 */
export function EntityPathLabel({
    parts,
    separator = " / ",
    truncateAt = -1,
    maxWidth = 150,
    size = "default",
    className,
}: EntityPathLabelProps) {
    // Filter out empty parts
    const filteredParts = parts.filter((part) => part !== null && part !== undefined && part !== "")

    if (filteredParts.length === 0) {
        return null
    }

    return (
        <span className={cn(flexLayouts.inlineCenter, sizeClasses[size], className)}>
            {filteredParts.map((part, index) => (
                <React.Fragment key={index}>
                    {index > 0 && (
                        <span className={cn(textColors.separator, "mx-0.5 flex-shrink-0")}>
                            {separator}
                        </span>
                    )}
                    {truncateAt === index ? (
                        <span
                            className="truncate"
                            style={{maxWidth}}
                            title={typeof part === "string" ? part : undefined}
                        >
                            {part}
                        </span>
                    ) : (
                        <span className="flex-shrink-0">{part}</span>
                    )}
                </React.Fragment>
            ))}
        </span>
    )
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Build entity path from selection path items
 */
export function buildEntityPath(
    items: {label: string}[],
    options?: {
        includeVersion?: boolean
        versionLabel?: string
    },
): string[] {
    const parts = items.map((item) => item.label)
    if (options?.includeVersion && options.versionLabel) {
        parts.push(options.versionLabel)
    }
    return parts
}

/**
 * Format entity label with optional version
 * Returns "EntityName vX" format
 */
export function formatEntityWithVersion(
    entityName: string,
    version?: number | string | null,
): string {
    if (version === null || version === undefined) {
        return entityName
    }
    return `${entityName} v${version}`
}
