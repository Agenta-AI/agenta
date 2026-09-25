import {Button} from "@agenta/ui/ui"
import {ArrowRight} from "@phosphor-icons/react"

import {AgentMark} from "./AgentMark"
import {ROW_BUTTON, connectionRowText} from "./helpers"
import {platformLogo} from "./icons"
import type {ChannelConnection} from "./types"

export interface ChannelConnectionCardProps {
    connection: ChannelConnection
    hostedHandle?: string
    onOpen: () => void
}

/** The card's status pill: live, waiting on a first chat, or broken. */
const statusOf = (connection: ChannelConnection): {label: string; dot: string} => {
    if (connection.status === "revoked") return {label: "Needs attention", dot: "bg-colorError"}
    if (connection.status === "pending") return {label: "Not linked yet", dot: "bg-colorWarning"}
    if (connection.agent === null) return {label: "No agent", dot: "bg-colorWarning"}
    return {label: "Live", dot: "bg-colorSuccess"}
}

/** One connection in Settings > Channels: the platform, the agent it answers as, and its state. */
export const ChannelConnectionCard = ({
    connection,
    hostedHandle,
    onOpen,
}: ChannelConnectionCardProps) => {
    const {title, detail} = connectionRowText(connection, hostedHandle)
    const status = statusOf(connection)
    const agentName = connection.agent?.name?.trim()
    return (
        <Button
            variant="outline"
            onClick={onOpen}
            data-testid={`channels-card-${connection.connectionId}`}
            // Replaces Button's svg sizing (merged by cn), so each svg keeps its own size.
            className={`${ROW_BUTTON} flex-col items-stretch gap-0 overflow-hidden rounded-lg p-0 hover:shadow-md [&_svg:not([class*='size-'])]:size-auto`}
        >
            <span className="relative flex h-[100px] items-center justify-center border-0 pt-5 border-b border-solid border-border bg-muted bg-[radial-gradient(var(--color-border)_1px,transparent_1px)] bg-[size:14px_14px]">
                <span className="absolute right-2.5 top-2.5 flex h-5 items-center gap-1.5 rounded-full border border-solid border-border bg-background px-2 text-[11px] font-medium text-muted-foreground">
                    <span className={`size-1.5 rounded-full ${status.dot}`} />
                    {status.label}
                </span>
                <AgentMark
                    agentId={connection.agent?.id}
                    size={38}
                    glyph={18}
                    className="rounded-[10px] shadow-sm"
                />
                {/* Two ways: messages reach the agent, and its replies go back. */}
                <svg
                    width={96}
                    height={14}
                    viewBox="0 0 96 14"
                    className="mx-2 flex-none text-foreground opacity-45"
                    aria-hidden="true"
                >
                    <path
                        d="M1 4 H95 M91 1 L95 4 L91 7 M95 10 H1 M5 7 L1 10 L5 13"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.25}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
                <span className="flex size-[38px] items-center justify-center rounded-[10px] bg-background shadow-sm">
                    {platformLogo(connection.platform, 20)}
                </span>
            </span>
            <span className="flex min-w-0 flex-col gap-0.5 px-4 pb-3 pt-3.5">
                <span className="truncate text-sm font-medium text-foreground">{title}</span>
                <span className="truncate text-[12.5px] font-normal text-muted-foreground">
                    {detail}
                </span>
            </span>
            <span className="flex min-w-0 items-center gap-2 border-0 border-t border-solid border-border px-4 py-2.5">
                {connection.agent === null ? (
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-normal text-muted-foreground">
                        No agent yet
                    </span>
                ) : (
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                        {agentName || "Unknown agent"}
                    </span>
                )}
                <ArrowRight size={13} className="flex-none text-muted-foreground" />
            </span>
        </Button>
    )
}
