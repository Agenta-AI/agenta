import {memo, useMemo} from "react"

import {useUserDisplayName} from "@agenta/entities/shared"
import {Avatar, Tag, Tooltip} from "antd"

// Color pairs matching the OSS Avatar component for visual consistency
const COLOR_PAIRS = [
    {bg: "#BAE0FF", text: "#1677FF"},
    {bg: "#D9F7BE", text: "#389E0D"},
    {bg: "#efdbff", text: "#722ED1"},
    {bg: "#fff1b8", text: "#AD6800"},
    {bg: "#D1F5F1", text: "#13C2C2"},
    {bg: "#ffd6e7", text: "#EB2F96"},
    {bg: "#f7cfcf", text: "#D61010"},
    {bg: "#eaeff5", text: "#758391"},
    {bg: "#D1E4E8", text: "#5E7579"},
    {bg: "#F5E6D3", text: "#825E31"},
    {bg: "#F9F6C1", text: "#84803A"},
    {bg: "#F4E6E4", text: "#9C706A"},
]

function getColorPair(name: string) {
    let hash = 0
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash)
    }
    return COLOR_PAIRS[Math.abs(hash) % COLOR_PAIRS.length]
}

function getInitials(name: string) {
    return name
        .split(" ")
        .slice(0, 2)
        .map((w) => (w[0] || "").toUpperCase())
        .join("")
}

/**
 * Resolves a single user ID and renders a tag with avatar badge.
 * Must be a separate component so each ID gets its own hook call.
 */
const UserTag = memo(function UserTag({userId}: {userId: string}) {
    const displayName = useUserDisplayName(userId)
    const name = displayName ?? userId.slice(0, 8)
    const color = getColorPair(name)

    return (
        <Tag className="!flex items-center gap-1.5 !pl-0.5">
            <Avatar
                size={18}
                shape="square"
                style={{backgroundColor: color.bg, color: color.text, fontSize: 9}}
            >
                {getInitials(name)}
            </Avatar>
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

    if (uniqueIds.length === 0) return null

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
