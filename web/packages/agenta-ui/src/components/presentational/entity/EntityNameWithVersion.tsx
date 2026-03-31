/**
 * EntityNameWithVersion Component
 *
 * Displays an entity name with version badge in "EntityName vX" format.
 * Used in selected values, tags, and chips.
 *
 * @example
 * ```tsx
 * import {EntityNameWithVersion} from '@agenta/ui'
 *
 * // Simple usage
 * <EntityNameWithVersion name="My Testset" version={3} />
 *
 * // With chip styling for version
 * <EntityNameWithVersion name="My App" version={2} versionVariant="chip" />
 *
 * // Truncated name
 * <EntityNameWithVersion name="Very Long Entity Name" version={1} maxNameWidth={150} />
 * ```
 */

import React from "react"

import {cn, sizeClasses, flexLayouts, textColors, type SizeVariant} from "../../../utils/styles"
import {VersionBadge, type VersionBadgeProps} from "../version"

// ============================================================================
// TYPES
// ============================================================================

export interface EntityNameWithVersionProps {
    /**
     * Entity name
     */
    name: string

    /**
     * Version number (optional - if not provided, only name is shown)
     */
    version?: number | string | null

    /**
     * Version badge variant
     * @default "chip"
     */
    versionVariant?: VersionBadgeProps["variant"]

    /**
     * Maximum width for name before truncation
     */
    maxNameWidth?: number

    /**
     * Size variant
     * @default "default"
     */
    size?: SizeVariant

    /**
     * Render as flex container (allows proper ellipsis)
     * @default true
     */
    flex?: boolean

    /**
     * Additional CSS class
     */
    className?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Displays entity name with optional version badge
 */
export function EntityNameWithVersion({
    name,
    version,
    versionVariant = "chip",
    maxNameWidth,
    size = "default",
    flex = true,
    className,
}: EntityNameWithVersionProps) {
    const content = (
        <>
            <span
                className={cn("truncate", maxNameWidth ? "flex-1 min-w-0" : undefined)}
                style={maxNameWidth ? {maxWidth: maxNameWidth} : undefined}
                title={name}
            >
                {name}
            </span>
            {version !== null && version !== undefined && (
                <VersionBadge
                    version={version}
                    variant={versionVariant}
                    size={size}
                    className="flex-shrink-0 ml-2"
                />
            )}
        </>
    )

    if (flex) {
        return (
            <span
                className={cn(
                    flexLayouts.inlineCenter,
                    "gap-1",
                    sizeClasses[size],
                    maxNameWidth ? "w-full" : undefined,
                    className,
                )}
            >
                {content}
            </span>
        )
    }

    return <span className={cn(sizeClasses[size], className)}>{content}</span>
}

// ============================================================================
// VARIANTS
// ============================================================================

/**
 * Entity name with version as inline text (no chip)
 * Format: "EntityName v3"
 */
export function EntityNameVersionText({
    name,
    version,
    className,
}: Pick<EntityNameWithVersionProps, "name" | "version" | "className">) {
    return (
        <span className={cn(sizeClasses.default, className)}>
            {name}
            {version !== null && version !== undefined && (
                <span className={cn("ml-1", textColors.muted)}>v{version}</span>
            )}
        </span>
    )
}
