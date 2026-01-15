/**
 * RevisionLabel Component
 *
 * A comprehensive revision display showing version, date, message, and author.
 * Used in revision menus, cascaders, and entity lists.
 *
 * @example
 * ```tsx
 * import {RevisionLabel} from '@agenta/ui'
 *
 * // Full revision details
 * <RevisionLabel
 *   version={3}
 *   createdAt="2024-01-15T10:30:00Z"
 *   message="Fix input validation"
 *   author="user-123"
 * />
 *
 * // Compact mode
 * <RevisionLabel version={3} compact />
 *
 * // With custom author renderer
 * <RevisionLabel
 *   version={3}
 *   author="user-123"
 *   renderAuthor={(id) => <UserAvatar userId={id} />}
 * />
 * ```
 */

import React from "react"

import {cn, flexLayouts, textColors} from "../../../utils/styles"
import {VersionBadge} from "../version"

// ============================================================================
// TYPES
// ============================================================================

export interface RevisionLabelProps {
    /**
     * Version number
     */
    version: number | string

    /**
     * Creation date (ISO string or Date)
     */
    createdAt?: string | Date | null

    /**
     * Commit message
     */
    message?: string | null

    /**
     * Author ID or name
     */
    author?: string | null

    /**
     * Custom author renderer
     */
    renderAuthor?: (author: string) => React.ReactNode

    /**
     * Compact mode - only shows version
     * @default false
     */
    compact?: boolean

    /**
     * Show date inline with version
     * @default true
     */
    showDateInline?: boolean

    /**
     * Maximum width for message truncation
     * @default 220
     */
    maxMessageWidth?: number

    /**
     * Additional CSS class
     */
    className?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Displays revision information with version, date, message, and author
 */
export function RevisionLabel({
    version,
    createdAt,
    message,
    author,
    renderAuthor,
    compact = false,
    showDateInline = true,
    maxMessageWidth = 220,
    className,
}: RevisionLabelProps) {
    // Format date
    const formattedDate = createdAt
        ? new Date(createdAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
          })
        : null

    // Compact mode - just version badge
    if (compact) {
        return <VersionBadge version={version} variant="bold" className={className} />
    }

    return (
        <div className={cn(flexLayouts.column, "gap-0.5", className)}>
            {/* Version and date row */}
            <div className={cn(flexLayouts.rowCenter, "gap-2")}>
                <VersionBadge version={version} variant="bold" />
                {showDateInline && formattedDate && (
                    <span className={textColors.muted}>{formattedDate}</span>
                )}
            </div>

            {/* Message */}
            {message && (
                <span
                    className={cn("truncate", textColors.muted)}
                    style={{maxWidth: maxMessageWidth}}
                    title={message}
                >
                    {message}
                </span>
            )}

            {/* Author */}
            {author && (
                <div className={textColors.muted}>
                    {renderAuthor ? renderAuthor(author) : <span>by {author}</span>}
                </div>
            )}
        </div>
    )
}

// ============================================================================
// VARIANTS
// ============================================================================

/**
 * Inline revision label - version with optional message on same line
 */
export function RevisionLabelInline({
    version,
    message,
    className,
}: Pick<RevisionLabelProps, "version" | "message" | "className">) {
    return (
        <span className={cn(flexLayouts.inlineCenter, "gap-1", className)}>
            <VersionBadge version={version} variant="bold" size="small" />
            {message && (
                <>
                    <span className={textColors.separator}>-</span>
                    <span
                        className={cn("truncate max-w-[150px]", textColors.muted)}
                        title={message}
                    >
                        {message}
                    </span>
                </>
            )}
        </span>
    )
}
