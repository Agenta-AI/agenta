import {DotsThreeIcon, Note, PencilSimple, Rocket, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Tooltip} from "antd"

import AgentActivityCell from "@/oss/components/pages/agent-home/components/YourAgentsTable/AgentActivityCell"
import type {AgentColumnActions} from "@/oss/components/pages/agent-home/components/YourAgentsTable/columns"
import type {AppWorkflowRow} from "@/oss/components/pages/app-management/store"

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

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => actions.onOpenPlayground(record)}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") actions.onOpenPlayground(record)
            }}
            className={`group box-border flex cursor-pointer flex-col gap-3 rounded-xl border border-solid border-colorBorderSecondary bg-colorBgElevated p-4 transition-colors hover:border-colorBorder ${
                variant === "grid" ? "h-full" : ""
            }`}
        >
            <div className="flex items-start gap-3">
                <span
                    aria-hidden
                    className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                    style={{background: color}}
                >
                    {initials}
                </span>

                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2">
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
                        {/* Where the mockup puts the session count, which has no API yet. */}
                        <span className="ml-auto shrink-0 text-xs text-colorTextTertiary">
                            <AgentActivityCell agentId={record.workflowId} />
                        </span>
                    </div>
                    {record.description ? (
                        <span className="line-clamp-2 text-[13px] leading-snug text-colorTextSecondary">
                            {record.description}
                        </span>
                    ) : null}
                </div>

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
            </div>
        </div>
    )
}

export default AgentCard
