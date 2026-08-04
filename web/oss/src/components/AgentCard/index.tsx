import {DotsThreeIcon, Note, PencilSimple, Rocket, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Tooltip} from "antd"

import {timeAgo} from "@/oss/components/AgentChatSlice/state/sessions"
import AgentActivityCell from "@/oss/components/pages/agent-home/components/YourAgentsTable/AgentActivityCell"
import type {AgentColumnActions} from "@/oss/components/pages/agent-home/components/YourAgentsTable/columns"
import type {AppWorkflowRow} from "@/oss/components/pages/app-management/store"
import UserReference from "@/oss/components/References/UserReference"

/** Deterministic so an agent keeps its colour across surfaces and reloads — index into a fixed
 * ramp by name, never random. */
const AVATAR_COLORS = [
    "#3b5bdb",
    "#2b8a3e",
    "#9c6644",
    "#7048e8",
    "#c92a2a",
    "#0b7285",
    "#5f3dc4",
    "#a9762a",
]

/** Initials come from the NAME, the colour from the ID: two agents can share a name (they often
 * do — "New agent"), and hashing the name gave them the same avatar, which is the one case the
 * avatar exists to solve. */
export const agentAvatar = (name: string, id: string) => {
    const words = name.trim().split(/\s+/).filter(Boolean)
    const initials = (words.length > 1 ? `${words[0][0]}${words[1][0]}` : name.slice(0, 2)) || "?"
    let hash = 0
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
    return {initials: initials.toUpperCase(), color: AVATAR_COLORS[hash % AVATAR_COLORS.length]}
}

/**
 * One agent, as a card. The same card on the rail and on the Agents page — the two differ only in
 * how much room they have, not in what an agent IS.
 *
 * The avatar is the point: two agents both named "New agent" are indistinguishable in a text row,
 * and a name is the one field we cannot rely on being distinct.
 */
const AgentCard = ({
    record,
    waiting,
    actions,
    variant = "rail",
}: {
    record: AppWorkflowRow
    waiting: number
    actions: AgentColumnActions
    /** `grid` is the Agents page (a wider cell); `rail` is the home column. */
    variant?: "rail" | "grid"
}) => {
    const {initials, color} = agentAvatar(record.name, record.workflowId)
    const isGrid = variant === "grid"

    const avatar = (
        <span
            aria-hidden
            className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${
                isGrid
                    ? // Straddling the top edge, as in the design: it reads as the agent's mark on
                      // the card rather than as the first cell of a row.
                      "absolute -top-5 left-4 size-10 border-2 border-solid border-colorBgContainer text-sm"
                    : "size-10 text-sm"
            }`}
            style={{background: color}}
        >
            {initials}
        </span>
    )

    const title = (
        <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-[15px] font-semibold text-colorText">
                {record.name}
            </span>
            {waiting > 0 ? (
                <Tooltip title={`${waiting} waiting on you`}>
                    <span className="shrink-0 rounded bg-colorWarningBg px-1.5 py-0.5 text-[11px] leading-none text-colorWarningText">
                        {waiting} waiting
                    </span>
                </Tooltip>
            ) : null}
            {/* The rail puts activity on the title line, where the design shows the session
                count; the grid carries it in the footer instead. */}
            {!isGrid ? (
                <span className="ml-auto shrink-0 text-xs text-colorTextTertiary">
                    <AgentActivityCell agentId={record.workflowId} />
                </span>
            ) : null}
        </div>
    )

    const description = record.description ? (
        <span className="line-clamp-2 text-[13px] leading-snug text-colorTextSecondary">
            {record.description}
        </span>
    ) : null

    const menu = (
        <Dropdown
            trigger={["click"]}
            menu={{
                items: [
                    {
                        key: "open_overview",
                        label: "Open overview",
                        icon: <Note size={16} />,
                        onClick: () => actions.onOpen(record),
                    },
                    {
                        key: "open_playground",
                        label: "Open in playground",
                        icon: <Rocket size={16} />,
                        onClick: () => actions.onOpenPlayground(record),
                    },
                    {
                        key: "rename",
                        label: "Rename",
                        icon: <PencilSimple size={16} />,
                        onClick: () => actions.onRename(record),
                    },
                    {type: "divider"},
                    {
                        key: "archive",
                        label: "Archive",
                        icon: <Trash size={16} />,
                        danger: true,
                        onClick: () => actions.onArchive(record),
                    },
                ],
            }}
        >
            <Button
                type="text"
                aria-label="Agent actions"
                className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                icon={<DotsThreeIcon size={14} />}
                onClick={(event) => event.stopPropagation()}
            />
        </Dropdown>
    )

    const open = () => actions.onOpenPlayground(record)

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={open}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") open()
            }}
            className={`group box-border flex cursor-pointer flex-col transition-colors ${
                isGrid
                    ? "relative h-full gap-2 rounded-xl border border-solid border-colorBorderSecondary bg-colorBgElevated p-4 pt-7 hover:border-colorBorder"
                    : // No frame in the rail: the section around it is already a card, and a card
                      // inside a card is the look we just spent the day removing.
                      "gap-2 rounded-lg p-3 hover:bg-colorFillQuaternary"
            }`}
        >
            {isGrid ? avatar : null}

            {isGrid ? (
                <>
                    <div className="flex items-start justify-between gap-2">
                        {title}
                        {menu}
                    </div>
                    {description}
                    {/* Footer: who made it and when it last ran. The design's integration badges
                        belong on this line — an agent's tools aren't on the row yet. */}
                    <div className="mt-auto flex items-center gap-2 pt-2 text-xs text-colorTextTertiary">
                        {record.createdById ? (
                            <UserReference userId={record.createdById} className="truncate" />
                        ) : null}
                        <span className="ml-auto shrink-0">
                            {record.updatedAt ? timeAgo(Date.parse(record.updatedAt)) : "—"}
                        </span>
                    </div>
                </>
            ) : (
                <div className="flex items-start gap-3">
                    {avatar}
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                        {title}
                        {description}
                    </div>
                    {menu}
                </div>
            )}
        </div>
    )
}

export default AgentCard
