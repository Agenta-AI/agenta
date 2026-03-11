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
 * <UserAuthorLabel userId={authorId} showYouLabel showAvatar />
 * ```
 */

import React, {useMemo} from "react"

import {Avatar} from "antd"

import {useUserDisplayName, useIsCurrentUser} from "./atoms"

// ============================================================================
// AVATAR HELPERS (self-contained, no @/oss dependency)
// ============================================================================

const COLOR_PAIRS = [
    {bg: "#BAE0FF", fg: "#1677FF"},
    {bg: "#D9F7BE", fg: "#389E0D"},
    {bg: "#efdbff", fg: "#722ED1"},
    {bg: "#fff1b8", fg: "#AD6800"},
    {bg: "#D1F5F1", fg: "#13C2C2"},
    {bg: "#ffd6e7", fg: "#EB2F96"},
    {bg: "#f7cfcf", fg: "#D61010"},
    {bg: "#eaeff5", fg: "#758391"},
    {bg: "#D1E4E8", fg: "#5E7579"},
    {bg: "#F5E6D3", fg: "#825E31"},
    {bg: "#F9F6C1", fg: "#84803A"},
    {bg: "#F4E6E4", fg: "#9C706A"},
]

function hashString(text: string): number {
    let hash = 0
    for (let i = 0; i < text.length; i++) {
        hash += text.charCodeAt(i)
    }
    return hash
}

function getColorPair(name: string) {
    const idx = ((hashString(name) % COLOR_PAIRS.length) + COLOR_PAIRS.length) % COLOR_PAIRS.length
    return COLOR_PAIRS[idx]
}

function getInitials(name: string, limit = 2): string {
    try {
        return name
            .split(" ")
            .slice(0, limit)
            .reduce((acc, w) => acc + (w[0] || "").toUpperCase(), "")
    } catch {
        return "?"
    }
}

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
     * Show a colored initials avatar badge before the name
     * @default false
     */
    showAvatar?: boolean

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
    showAvatar = false,
    fallback = null,
    className,
}: UserAuthorLabelProps) {
    const displayName = useUserDisplayName(userId)
    const isCurrentUser = useIsCurrentUser(userId)

    const avatarStyle = useMemo(() => {
        if (!showAvatar || !displayName) return undefined
        const pair = getColorPair(displayName)
        return {backgroundColor: pair.bg, color: pair.fg}
    }, [showAvatar, displayName])

    // No user ID or user not found
    if (!userId || !displayName) {
        if (fallback) {
            return <span className={className}>{fallback}</span>
        }
        return null
    }

    const label = showYouLabel && isCurrentUser ? `${displayName} (you)` : displayName

    return (
        <span className={className} style={{display: "inline-flex", alignItems: "center", gap: 6}}>
            {showAvatar && (
                <Avatar
                    shape="square"
                    size={16}
                    style={{...avatarStyle, fontSize: 9, lineHeight: "16px"}}
                >
                    {getInitials(displayName)}
                </Avatar>
            )}
            {showPrefix && prefix && `${prefix} `}
            {label}
        </span>
    )
}
