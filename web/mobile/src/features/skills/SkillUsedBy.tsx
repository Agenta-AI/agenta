import {projectIdAtom} from "@agenta/shared/state"
import {useSkillUsage} from "@agenta/skills-ui"
import {cn} from "@agenta/ui/styles"
import {HoverCard, HoverCardContent, HoverCardTrigger} from "@agenta/ui/ui"
import {Robot} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import Link from "next/link"
import {useRouter} from "next/router"

import {agentEntryHref} from "../agents/agentEntry"

import {usedByLabel} from "./skillListView"

/** Who uses a skill: the agent's name for one, "N agents" with the names on hover for more. */
export const SkillUsedBy = ({
    workflowId,
    count,
    className,
}: {
    workflowId: string
    count: number
    className?: string
}) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const {query} = useRouter()
    const {agents} = useSkillUsage(projectId, workflowId, count > 0)
    const text = cn("truncate", count ? "text-foreground" : "text-muted-foreground", className)

    if (agents.length === 1) return <span className={text}>{agents[0].name}</span>
    if (agents.length < 2) return <span className={text}>{usedByLabel(count)}</span>

    const base = `/w/${query.workspace_id}/p/${query.project_id}`
    return (
        <HoverCard openDelay={100}>
            <HoverCardTrigger asChild>
                <span
                    tabIndex={0}
                    className={cn(text, "relative z-[1] cursor-default")}
                    onClick={(event) => event.stopPropagation()}
                >
                    {agents.length} agents
                </span>
            </HoverCardTrigger>
            <HoverCardContent align="start" className="w-[240px] p-1.5">
                <span className="block px-2 pb-1.5 pt-1 text-xs text-muted-foreground">
                    Used by {agents.length} agents
                </span>
                {agents.map((agent) => (
                    <Link
                        key={agent.id || agent.name}
                        href={agentEntryHref(base, agent.id)}
                        className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-foreground no-underline hover:bg-accent"
                    >
                        <span
                            aria-hidden
                            className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-[5px] border border-solid border-border bg-accent text-muted-foreground"
                        >
                            <Robot size={13} />
                        </span>
                        <span className="truncate">{agent.name}</span>
                    </Link>
                ))}
            </HoverCardContent>
        </HoverCard>
    )
}
