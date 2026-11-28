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

import {cn} from "../../ui/utils"
import {VersionBadge} from "../version"

import {AuthorLabel} from "./AuthorLabel"

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
     * Reserve space for subtitle rows (message/author) even when not present.
     * Used for consistent height in select components.
     * @default false
     */
    reserveSubtitleSpace?: boolean

    /**
     * Additional CSS class
     */
    className?: string

    /**
     * Variant name to display alongside the version badge.
     * Shown when revisions from multiple variants are listed together (e.g. skip-variant mode).
     */
    variantName?: string | null
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
    showDateInline = false,
    maxMessageWidth = 220,
    reserveSubtitleSpace = false,
    className,
    variantName,
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
        return <VersionBadge version={version} variant="chip" className={className} />
    }

    // Message element - show actual message or invisible spacer for consistent height
    const messageElement = message ? (
        <span
            className="truncate text-muted-foreground"
            style={{maxWidth: maxMessageWidth}}
            title={message}
        >
            {message}
        </span>
    ) : reserveSubtitleSpace ? (
        <span className="invisible text-muted-foreground">&nbsp;</span>
    ) : null

    // Author element - show actual author or invisible spacer for consistent height
    const authorElement = author ? (
        <div className="text-muted-foreground">
            {renderAuthor ? renderAuthor(author) : <AuthorLabel author={author} />}
        </div>
    ) : reserveSubtitleSpace ? (
        <div className="invisible text-muted-foreground">&nbsp;</div>
    ) : null

    return (
        <div className={cn("flex flex-col gap-0.5", className)}>
            {/* Version and date row */}
            <div className="flex items-center gap-2">
                <VersionBadge version={version} variant="chip" />
                {variantName && (
                    <span
                        className="truncate text-meta text-muted-foreground"
                        style={{maxWidth: 120}}
                        title={variantName}
                    >
                        {variantName}
                    </span>
                )}
                {showDateInline && (formattedDate || reserveSubtitleSpace) && (
                    <span className={cn("text-muted-foreground", !formattedDate && "invisible")}>
                        {formattedDate || ""}
                    </span>
                )}
            </div>

            {/* Message */}
            {messageElement}

            {/* Author */}
            {authorElement}
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
        <span className={cn("inline-flex items-center gap-1", className)}>
            <VersionBadge version={version} variant="chip" size="small" />
            {message && (
                <>
                    <span className="text-muted-foreground">-</span>
                    <span className="truncate max-w-[150px] text-muted-foreground" title={message}>
                        {message}
                    </span>
                </>
            )}
        </span>
    )
}
