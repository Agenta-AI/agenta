import {memo, useMemo} from "react"

import {useUserDisplayName} from "@agenta/entities/shared"
import {InitialsAvatar} from "@agenta/ui"
import {Tag, Tooltip, Typography} from "antd"

/**
 * Resolves a single user ID and renders a tag with avatar badge.
 * Must be a separate component so each ID gets its own hook call.
 */
const UserTag = memo(function UserTag({userId}: {userId: string}) {
    const displayName = useUserDisplayName(userId)
    const name = displayName ?? userId.slice(0, 8)

    return (
        <Tag className="!flex items-center gap-1.5 !pl-0.5">
            <InitialsAvatar size={18} name={name} className="text-[9px]" />
            {name}
        </Tag>
    )
})

interface AssignmentsCellProps {
    assignments: string[][] | null | undefined
}

/**
 * Cell that renders assignees from a queue's assignments field.
 * The assignments field is a 2D array: [[user_a, user_b], [user_c]]
 * where each inner array represents assignees for one repeat.
 *
 * Deduplicates user IDs across all repeats for display.
 */
const AssignmentsCell = memo(function AssignmentsCell({assignments}: AssignmentsCellProps) {
    const uniqueIds = useMemo(() => {
        if (!assignments || !Array.isArray(assignments)) return []
        const set = new Set<string>()
        for (const repeat of assignments) {
            if (!Array.isArray(repeat)) continue
            for (const userId of repeat) {
                if (typeof userId === "string" && userId) {
                    set.add(userId)
                }
            }
        }
        return Array.from(set)
    }, [assignments])

    if (uniqueIds.length === 0) {
        return <Typography.Text type="secondary">All</Typography.Text>
    }

    // Show first 2 inline, rest in a tooltip
    const visible = uniqueIds.slice(0, 2)
    const remaining = uniqueIds.slice(2)

    return (
        <div className="flex items-center gap-1 overflow-hidden">
            {visible.map((id) => (
                <UserTag key={id} userId={id} />
            ))}
            {remaining.length > 0 && (
                <Tooltip
                    title={
                        <div className="flex flex-col gap-1">
                            {remaining.map((id) => (
                                <UserTag key={id} userId={id} />
                            ))}
                        </div>
                    }
                >
                    <Tag className="cursor-default">+{remaining.length}</Tag>
                </Tooltip>
            )}
        </div>
    )
})

export default AssignmentsCell
