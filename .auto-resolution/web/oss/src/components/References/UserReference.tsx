import {memo} from "react"

import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {Typography} from "antd"

export interface UserReferenceProps {
    /** The user ID to display */
    userId: string | null | undefined
    /** Show skeleton while loading (for virtualized tables) */
    showSkeleton?: boolean
    /** Custom class name for the container */
    className?: string
}

/**
 * A generic user reference component that displays user information based on user ID.
 * Delegates to UserAuthorLabel from @agenta/entities for user resolution and display.
 */
export const UserReference = memo(({userId, className}: UserReferenceProps) => {
    if (!userId) {
        return <Typography.Text type="secondary">—</Typography.Text>
    }

    return (
        <UserAuthorLabel
            userId={userId}
            showAvatar
            showYouLabel
            fallback="—"
            className={className}
        />
    )
})

UserReference.displayName = "UserReference"

export default UserReference
