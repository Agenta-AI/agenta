import type {Workflow} from "@agenta/entities/workflow"
import {agentAvatar} from "@agenta/entity-ui/agent"
import {ChevronRight} from "lucide-react"
import Link from "next/link"

import {ROW_LINK} from "@/lib/interactive"

/**
 * A roster row: the shared avatar rules (colour hashes the ID, initials the name), name, and a
 * tap into the agent's overview. Mirrors the desktop rail's card content.
 */
export const AgentListRow = ({agent, href}: {agent: Workflow; href: string}) => {
    const label = agent.name || agent.slug || "Untitled agent"
    const avatar = agentAvatar(label, agent.id)
    return (
        <Link
            href={href}
            className={`border-border flex items-center gap-3 border-b px-4 py-3 ${ROW_LINK}`}
        >
            <span
                className="flex size-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold text-white"
                style={{backgroundColor: avatar.color}}
            >
                {avatar.initials}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{label}</span>
            <ChevronRight className="text-muted-foreground size-4 shrink-0" />
        </Link>
    )
}
