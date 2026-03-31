import {memo, useMemo} from "react"

import {Typography} from "antd"
import {useAtomValue} from "jotai"

import {userAtom} from "@/oss/state/profile/selectors/user"
import {workspaceMemberByIdFamily} from "@/oss/state/workspace/atoms/selectors"

import Avatar from "../Avatar/Avatar"

export interface UserReferenceProps {
    /** The user ID to display */
    userId: string | null | undefined
    /** Show skeleton while loading (for virtualized tables) */
    showSkeleton?: boolean
    /** Custom class name for the container */
    className?: string
}

/**
 * Resolves the display name from a workspace member
 */
const resolveDisplayName = (
    member: {user?: {username?: string; name?: string; email?: string}} | null,
): string | null => {
    if (!member?.user) return null
    const {username, name, email} = member.user as {
        username?: string
        name?: string
        email?: string
    }
    const candidate = username ?? name ?? email
    return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : null
}

/**
 * Normalizes a string for comparison (lowercase, trimmed)
 */
const normalize = (value: string | null | undefined): string | null =>
    typeof value === "string" && value.trim().length ? value.trim().toLowerCase() : null

/**
 * A generic user reference component that displays user information based on user ID.
 * Uses workspace member data to resolve user details.
 */
export const UserReference = memo(({userId, showSkeleton, className}: UserReferenceProps) => {
    const memberAtom = useMemo(() => workspaceMemberByIdFamily(userId ?? null), [userId])
    const member = useAtomValue(memberAtom)
    const currentUser = useAtomValue(userAtom)

    // Resolve display name from member
    const displayName = resolveDisplayName(member)

    // Check if this is the current user
    const isCurrentUser = useMemo(() => {
        if (!currentUser || !userId) return false

        const currentUserId = currentUser.id
        const currentUsername = normalize(currentUser.username)
        const currentEmail = normalize(currentUser.email)

        // Check by ID
        if (currentUserId && String(currentUserId) === String(userId)) {
            return true
        }

        // Check by username/email match
        const memberUsername = normalize(member?.user?.username)
        const memberEmail = normalize(member?.user?.email)

        if (currentUsername && memberUsername && currentUsername === memberUsername) {
            return true
        }
        if (currentEmail && memberEmail && currentEmail === memberEmail) {
            return true
        }

        return false
    }, [currentUser, userId, member])

    // No user ID provided
    if (!userId) {
        return <Typography.Text type="secondary">—</Typography.Text>
    }

    // User not found in workspace
    if (!displayName) {
        return <Typography.Text type="secondary">—</Typography.Text>
    }

    const label = isCurrentUser ? `${displayName} (you)` : displayName

    return (
        <span
            className={`flex items-center gap-1.5 text-ellipsis overflow-hidden whitespace-nowrap ${className ?? ""}`}
        >
            <Avatar name={displayName} className="w-4 h-4 text-[9px] shrink-0" />
            <span className="truncate">{label}</span>
        </span>
    )
})

UserReference.displayName = "UserReference"

export default UserReference
