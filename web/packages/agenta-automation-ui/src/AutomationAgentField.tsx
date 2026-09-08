import {useMemo} from "react"

import {agentWorkflowsListQueryStateAtom, type Workflow} from "@agenta/entities/workflow"
import {AgentGlyph} from "@agenta/entity-ui/agent"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Skeleton,
} from "@agenta/ui/ui"
import {Robot} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {AutomationField} from "./AutomationField"

/**
 * Which agent the automation runs.
 *
 * A selector, not a list of buttons: this is the same `Select` every other field in the app uses,
 * so it closes on pick, marks the bound one, and lines up with the "Runs when" trigger beside it
 * (both are `selectTriggerVariants` at `h-auto py-input-y`).
 *
 * The pick is never saved here: both hosts hold the whole config as one unsaved draft (the draft
 * screen until Create, the detail screen until Save), and a field that wrote the binding on its own
 * would make the agent the one setting that changed before the user asked for it. Without
 * `onSelectAgent` it reads as a bound fact rather than offering a dead tap target.
 */
export const AutomationAgentField = ({
    agentId = null,
    agentName,
    onSelectAgent,
}: {
    /** The agent the draft currently binds. */
    agentId?: string | null
    agentName: string | null
    /** Absent ⇒ the field reads only. */
    onSelectAgent?: (agentId: string) => void
}) => {
    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agents = useMemo<Workflow[]>(() => agentsQuery.data ?? [], [agentsQuery.data])

    return (
        <AutomationField
            label="Agent"
            helper="This agent does the work, with the tools it already has."
        >
            <Select
                value={agentId ?? undefined}
                onValueChange={(next) => onSelectAgent?.(next)}
                disabled={!onSelectAgent}
            >
                {/* h-auto py-input-y: the same treatment `ScheduleBuilderField` gives its own
                    trigger, so the two controls are one height. Not dimmed while there is
                    nothing to open — the bound agent is still a fact to read. */}
                <SelectTrigger
                    aria-label="Agent"
                    className="h-auto py-input-y disabled:cursor-default disabled:border-border disabled:bg-background disabled:text-foreground"
                >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                        <AgentGlyph
                            workflowId={agentId}
                            size={16}
                            fallback={<Robot aria-hidden size={16} />}
                            className="text-muted-foreground shrink-0"
                        />
                        <SelectValue className="min-w-0 truncate" placeholder="Pick an agent">
                            {agentName}
                        </SelectValue>
                    </span>
                </SelectTrigger>
                <SelectContent className="max-h-[320px]">
                    {agentsQuery.isPending ? (
                        // Row geometry, not a spinner — the list replaces this without shifting.
                        <div className="flex flex-col gap-1 p-1">
                            <Skeleton className="h-7 w-full" />
                            <Skeleton className="h-7 w-4/5" />
                            <Skeleton className="h-7 w-3/5" />
                        </div>
                    ) : agents.length === 0 ? (
                        <p className="text-muted-foreground m-0 px-3 py-6 text-center text-xs">
                            No agents in this project yet.
                        </p>
                    ) : (
                        agents.map((agent) =>
                            agent.id ? (
                                <SelectItem key={agent.id} value={agent.id}>
                                    {agent.name?.trim() || agent.slug?.trim() || "Untitled agent"}
                                </SelectItem>
                            ) : null,
                        )
                    )}
                </SelectContent>
            </Select>
        </AutomationField>
    )
}
