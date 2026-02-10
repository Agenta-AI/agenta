/**
 * UserAuthorLabel Component
 *
 * A component for displaying author information with user ID resolution.
 * Uses the shared user atoms to resolve user IDs to display names.
 *
 * @example
 * ```tsx
 * import {UserAuthorLabel} from '@agenta/entities/shared'
 *
 * <UserAuthorLabel userId={authorId} />
 * <UserAuthorLabel userId={authorId} showYouLabel />
 * ```
 */

import React from "react"

import {useUserDisplayName, useIsCurrentUser} from "./atoms"

// ============================================================================
// TYPES
// ============================================================================

export interface UserAuthorLabelProps {
    /**
     * User ID to resolve and display
     */
    userId: string | null | undefined

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
     * Show "(you)" label for current user
     * @default true
     */
    showYouLabel?: boolean

    /**
     * Fallback text when user not found
     * @default null (renders nothing)
     */
    fallback?: string | null

    /**
     * Additional CSS class
     */
    className?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Displays author information with user ID resolution
 */
export function UserAuthorLabel({
    userId,
    prefix = "by",
    showPrefix = true,
    showYouLabel = true,
    fallback = null,
    className,
}: UserAuthorLabelProps) {
    const displayName = useUserDisplayName(userId)
    const isCurrentUser = useIsCurrentUser(userId)

    // No user ID or user not found
    if (!userId || !displayName) {
        if (fallback) {
            return <span className={className}>{fallback}</span>
        }
        return null
    }

    const label = showYouLabel && isCurrentUser ? `${displayName} (you)` : displayName

    return (
        <span className={className}>
            {showPrefix && prefix && `${prefix} `}
            {label}
        </span>
    )
}
