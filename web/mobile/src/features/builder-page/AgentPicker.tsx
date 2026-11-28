import {useMemo, useState, type ReactNode} from "react"

import {
    agentWorkflowsListQueryStateAtom,
    invalidateWorkflowsListCache,
} from "@agenta/entities/workflow"
import {AgentChip} from "@agenta/entity-ui/agent"
import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {SearchInput, SkeletonRows} from "@agenta/ui/composed"
import {Button, MENU_ITEM, Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {cn} from "@/lib/utils"

import type {AgentRef} from "./paneAgent"

/**
 * The agent list behind "Optimize an agent": the project's agents with a search. A pick names the
 * agent; the caller puts its chip in the composer.
 */
export const AgentPicker = ({
    trigger,
    onPick,
}: {
    trigger: ReactNode
    onPick: (agent: AgentRef) => void
}) => {
    const t = useT(builderPageCatalog)
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState("")
    const agents = useAtomValue(agentWorkflowsListQueryStateAtom)
    const rows = useMemo(() => {
        const query = search.trim().toLowerCase()
        return (agents.data ?? [])
            .map((agent) => ({id: agent.id, name: agent.name || agent.slug || ""}))
            .filter((agent) => !query || agent.name.toLowerCase().includes(query))
    }, [agents.data, search])
    const failed = agents.isError && (agents.data ?? []).length === 0
    const none = !agents.isPending && !failed && (agents.data ?? []).length === 0

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                setOpen(next)
                if (!next) setSearch("")
            }}
        >
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent
                align="center"
                className="flex w-popover-md max-w-[calc(100vw-2rem)] flex-col gap-1 p-1"
                data-testid="builder-agent-picker"
            >
                <p className="m-0 px-2 pb-1 pt-1 text-meta text-muted-foreground">
                    {t("builder.page.pickAgent")}
                </p>
                {none || failed ? null : (
                    <SearchInput
                        aria-label={t("builder.page.searchAgents")}
                        placeholder={t("builder.page.searchAgents")}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                    />
                )}
                <div className="flex max-h-64 flex-col overflow-y-auto">
                    {agents.isPending ? (
                        <SkeletonRows count={3} />
                    ) : failed ? (
                        <div className="flex flex-col items-start gap-1 px-1 py-2">
                            <p className="m-0 text-body text-muted-foreground">
                                {t("builder.page.agentsFailed")}
                            </p>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={agents.isFetching}
                                onClick={() => invalidateWorkflowsListCache()}
                            >
                                {t("builder.page.retry")}
                            </Button>
                        </div>
                    ) : none ? (
                        <p className="m-0 px-1 py-2 text-body text-muted-foreground">
                            {t("builder.page.noAgents")}
                        </p>
                    ) : rows.length === 0 ? (
                        <p className="m-0 px-1 py-2 text-body text-muted-foreground">
                            {t("builder.page.noAgentMatches")}
                        </p>
                    ) : (
                        rows.map((agent) => (
                            <button
                                key={agent.id}
                                type="button"
                                onClick={() => {
                                    setOpen(false)
                                    setSearch("")
                                    onPick(agent)
                                }}
                                className={cn(
                                    MENU_ITEM,
                                    "shrink-0 border-0 bg-transparent text-left text-foreground hover:bg-accent focus-visible:bg-accent",
                                )}
                            >
                                <AgentChip workflowId={agent.id} box="size-5" glyph={14} />
                                <span className="truncate">{agent.name}</span>
                            </button>
                        ))
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}
