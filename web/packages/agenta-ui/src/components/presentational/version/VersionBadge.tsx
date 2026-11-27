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

import {useT} from "@agenta/i18n"
import uiStatusCatalog from "@agenta/i18n/catalogs/ui.status"

import {type SizeVariant} from "../../../utils/styles"
import {Badge} from "../../ui/badge"
import {cn} from "../../ui/utils"

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
     * - "chip": The kit Badge
     * - "bold": Bold text
     * @default "text"
     */
    variant?: "text" | "chip" | "bold"

    /**
     * Size variant. Unused: the text inherits its size from the parent.
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
export function VersionBadge({version, variant = "text", className}: VersionBadgeProps) {
    const t = useT(uiStatusCatalog)
    const title = t("ui.status.versionTitle", {version})
    const label = t("ui.status.versionShort", {version})

    if (variant === "chip") {
        return (
            <Badge variant="default" className={className} title={title}>
                {label}
            </Badge>
        )
    }

    return (
        <span className={cn(variant === "bold" && "font-medium", className)} title={title}>
            {label}
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
