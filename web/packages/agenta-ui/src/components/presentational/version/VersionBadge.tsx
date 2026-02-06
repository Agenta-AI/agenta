/**
 * VersionBadge Component
 *
 * A simple badge displaying version numbers in "vX" format.
 * Used consistently across entity selection, revision displays, and references.
 *
 * @example
 * ```tsx
 * import {VersionBadge} from '@agenta/ui'
 *
 * // Simple usage
 * <VersionBadge version={3} />
 *
 * // With variant styling
 * <VersionBadge version={3} variant="chip" />
 *
 * // Different sizes
 * <VersionBadge version={3} size="small" />
 * ```
 */

import React from "react"

import {cn, sizeClasses, flexLayouts, bgColors, type SizeVariant} from "../../../utils/styles"

// ============================================================================
// TYPES
// ============================================================================

export interface VersionBadgeProps {
    /**
     * Version number to display
     */
    version: number | string

    /**
     * Display variant
     * - "text": Plain text "v3"
     * - "chip": Badge with background
     * - "bold": Bold text
     * @default "text"
     */
    variant?: "text" | "chip" | "bold"

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
 * Displays a version number in consistent "vX" format
 */
export function VersionBadge({
    version,
    variant = "text",
    size = "default",
    className,
}: VersionBadgeProps) {
    const variantClasses = {
        text: "",
        bold: "font-medium",
        chip: cn(
            flexLayouts.inlineCenter,
            bgColors.chip,
            "px-1.5 py-0.5 rounded text-gray-700 font-medium",
        ),
    }

    return (
        <span
            className={cn(sizeClasses[size], variantClasses[variant], className)}
            title={`Version ${version}`}
        >
            v{version}
        </span>
    )
}

// ============================================================================
// HELPER
// ============================================================================

/**
 * Format version number to string
 * Handles various input formats (number, string, undefined)
 */
export function formatVersion(version: number | string | null | undefined, fallback = "?"): string {
    if (version === null || version === undefined) return fallback
    return `v${version}`
}
