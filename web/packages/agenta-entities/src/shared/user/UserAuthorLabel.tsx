/**
 * UserAuthorLabel Component
 *
 * A component for displaying author information with optional user ID resolution.
 * Supports two modes:
 * - **ID mode**: Pass `userId` to resolve display name from workspace members
 * - **Name mode**: Pass `name` directly for display without resolution
 *
 * @example
 * ```tsx
 * import {UserAuthorLabel} from '@agenta/entities/shared'
 *
 * // Resolve from user ID
 * <UserAuthorLabel userId={authorId} />
 * <UserAuthorLabel userId={authorId} showYouLabel showAvatar />
 *
 * // Display name directly
 * <UserAuthorLabel name="John Doe" showAvatar />
 * ```
 */

import {BylineText, InitialsAvatar} from "@agenta/ui"

import {useUserDisplayName, useIsCurrentUser} from "./atoms"

// ============================================================================
// TYPES
// ============================================================================

export interface UserAuthorLabelProps {
    /**
     * User ID to resolve and display.
     * When provided, the component resolves the display name from workspace members.
     */
    userId?: string | null | undefined

    /**
     * Display name to show directly (no resolution needed).
     * Used as fallback when `userId` is also provided but cannot be resolved.
     */
    name?: string | null

    /**
     * Prefix text (e.g., "by")
     * @default "by"
     */
    prefix?: string

    /**
     * Show prefix
     * @default false
     */
    showPrefix?: boolean

    /**
     * Show "(you)" label for current user
     * @default false
     */
    showYouLabel?: boolean

    /**
     * Show a colored initials avatar badge before the name
     * @default false
     */
    showAvatar?: boolean

    /**
     * Fallback text when user not found and no name provided
     * @default null (renders nothing)
     */
    fallback?: string | null

    /**
     * The time of the last change (`updated_at`, else `created_at`). With it the label reads
     * "By NAME, TIME", or "By you, TIME" for the current user, whatever `prefix` and
     * `showPrefix` say.
     */
    at?: string | null

    /**
     * Additional CSS class
     */
    className?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Displays author information with optional user ID resolution
 */
export function UserAuthorLabel({
    userId,
    name,
    prefix = "by",
    showPrefix = false,
    showYouLabel = false,
    showAvatar = false,
    fallback = null,
    at,
    className,
}: UserAuthorLabelProps) {
    const resolvedName = useUserDisplayName(userId ?? undefined)
    const isCurrentUser = useIsCurrentUser(userId ?? undefined)

    const displayName =
        (resolvedName && resolvedName !== "-" ? resolvedName : undefined) || name || null
    const withTime = Boolean(at) && Number.isFinite(Date.parse(at as string))

    if (withTime && (displayName || isCurrentUser)) {
        return (
            <span
                className={`inline-flex items-center gap-1.5 text-ellipsis overflow-hidden ${className ?? ""}`}
            >
                {showAvatar && displayName && (
                    <InitialsAvatar name={displayName} className="w-4 h-4 text-caption" />
                )}
                <BylineText name={displayName ?? ""} at={at as string} isYou={isCurrentUser} />
            </span>
        )
    }

    if (!displayName) {
        if (fallback) {
            return <span className={className}>{fallback}</span>
        }
        return null
    }

    const label = showYouLabel && isCurrentUser ? `${displayName} (you)` : displayName

    return (
        <span
            className={`inline-flex items-center gap-1.5 text-ellipsis overflow-hidden ${className ?? ""}`}
        >
            {showAvatar && <InitialsAvatar name={displayName} className="w-4 h-4 text-caption" />}
            {showPrefix && prefix && `${prefix} `}
            {label}
        </span>
    )
}
