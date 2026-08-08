import type {ReactNode} from "react"

import {timeAgo} from "@agenta/shared/utils"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {DotsThreeIcon, Note, PencilSimple, Rocket, Trash} from "@phosphor-icons/react"

import {Tip} from "./Tip"

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

/** What the card needs to know about an agent — nothing app-shaped. */
export interface AgentCardData {
    id: string
    name: string
    description?: string | null
    /** ISO timestamp of the last configuration change — the grid footer's right edge. */
    updatedAt?: string | null
}

export interface AgentCardProps {
    agent: AgentCardData
    /** Sessions blocked on you for this agent — the amber badge beside the name. */
    waiting?: number
    /** `grid` is the Agents page (a wider cell); `rail` is the home column. */
    variant?: "rail" | "grid"
    /** Data-connected cells stay app-side and arrive as slots: last activity (rail title
     * line) and creator (grid footer). */
    activity?: ReactNode
    owner?: ReactNode
    onOpenOverview: () => void
    onOpenPlayground: () => void
    onRename: () => void
    onArchive: () => void
}

/**
 * One agent, as a card. The same card on the rail and on the Agents page — the two differ only in
 * how much room they have, not in what an agent IS.
 *
 * The avatar is the point: two agents both named "New agent" are indistinguishable in a text row,
 * and a name is the one field we cannot rely on being distinct.
 */
export const AgentCard = ({
    agent,
    waiting = 0,
    variant = "rail",
    activity,
    owner,
    onOpenOverview,
    onOpenPlayground,
    onRename,
    onArchive,
}: AgentCardProps) => {
    const {initials, color} = agentAvatar(agent.name, agent.id)
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
            {/* Rail rows read like session rows (14/regular); the grid card keeps a heading. */}
            <span
                className={`min-w-0 truncate text-colorText ${
                    isGrid ? "text-base font-semibold" : "text-sm"
                }`}
            >
                {agent.name}
            </span>
            {waiting > 0 ? (
                <Tip title={`${waiting} waiting on you`}>
                    <span className="shrink-0 rounded bg-colorWarningBg px-1.5 py-0.5 text-xs leading-none text-colorWarningText">
                        {waiting} waiting
                    </span>
                </Tip>
            ) : null}
            {/* The rail puts activity on the title line, where the design shows the session
                count; the grid carries it in the footer instead. */}
            {!isGrid && activity ? (
                <span className="ml-auto shrink-0 text-xs text-colorTextTertiary">{activity}</span>
            ) : null}
        </div>
    )

    const description = agent.description ? (
        <span className="line-clamp-2 text-[13px] leading-snug text-colorTextSecondary">
            {agent.description}
        </span>
    ) : null

    const menu = (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Agent actions"
                    className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={(event) => event.stopPropagation()}
                >
                    <DotsThreeIcon size={14} />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                <DropdownMenuItem onSelect={onOpenOverview}>
                    <Note size={16} />
                    Open overview
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onOpenPlayground}>
                    <Rocket size={16} />
                    Open in playground
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onRename}>
                    <PencilSimple size={16} />
                    Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onArchive}>
                    <Trash size={16} />
                    Archive
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onOpenPlayground}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onOpenPlayground()
            }}
            className={`group box-border flex cursor-pointer flex-col transition-colors ${
                isGrid
                    ? "relative h-full gap-2.5 rounded-xl border border-solid border-colorBorderSecondary bg-colorBgElevated p-5 pt-8 hover:border-colorBorder"
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
                    <div className="mt-auto flex items-center gap-2 pt-3 text-xs text-colorTextTertiary">
                        {owner}
                        <span className="ml-auto shrink-0">
                            {agent.updatedAt ? timeAgo(Date.parse(agent.updatedAt)) : "—"}
                        </span>
                    </div>
                </>
            ) : (
                <div
                    className={`flex gap-3 ${
                        // Without a description the title is one 24px line against a 40px
                        // avatar, and top-alignment left the name riding high.
                        description ? "items-start" : "items-center"
                    }`}
                >
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
