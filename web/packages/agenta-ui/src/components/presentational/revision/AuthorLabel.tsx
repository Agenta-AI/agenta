/**
 * AuthorLabel Component
 *
 * A simple component for displaying author information.
 * This is a presentational component that just displays the author string.
 * For user ID resolution, use the app-level UserReference component or
 * provide a custom renderAuthor function to RevisionLabel.
 *
 * @example
 * ```tsx
 * import {AuthorLabel} from '@agenta/ui'
 *
 * <AuthorLabel author="user@example.com" />
 * <AuthorLabel author="user@example.com" prefix="by" />
 * ```
 */

import React from "react"

import {cn, textColors} from "../../../utils/styles"

// ============================================================================
// TYPES
// ============================================================================

export interface AuthorLabelProps {
    /**
     * Author string (name, email, or ID)
     */
    author: string | null | undefined

    /**
     * Prefix text (e.g., "by")
     * @default "by"
     */
    prefix?: string

    /**
     * Show prefix
     * @default true
     */
    showPrefix?: boolean

    /**
     * Additional CSS class
     */
    className?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Displays author information with optional prefix
 */
export function AuthorLabel({
    author,
    prefix = "by",
    showPrefix = true,
    className,
}: AuthorLabelProps) {
    if (!author) return null

    return (
        <span className={cn(textColors.muted, className)}>
            {showPrefix && prefix && `${prefix} `}
            {author}
        </span>
    )
}
