import {useMemo, useState, type ReactNode} from "react"

import {agentWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {Popover, PopoverContent, PopoverTrigger, SearchInput, SkeletonRows} from "@agenta/ui/ui"
import {Robot} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import type {AgentRef} from "./paneAgent"

/**
 * The agent list behind "Improve an agent": the project's agents with a search. A pick names the
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
    const none = !agents.isPending && (agents.data ?? []).length === 0

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
                className="flex w-72 flex-col gap-1 p-2"
                data-testid="builder-agent-picker"
            >
                <p className="m-0 px-1 pb-1 text-xs font-medium text-colorTextSecondary">
                    {t("builder.page.pickAgent")}
                </p>
                {none ? null : (
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
                    ) : none ? (
                        <p className="m-0 px-1 py-2 text-[13px] text-colorTextSecondary">
                            {t("builder.page.noAgents")}
                        </p>
                    ) : rows.length === 0 ? (
                        <p className="m-0 px-1 py-2 text-[13px] text-colorTextSecondary">
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
                                className="flex h-8 w-full shrink-0 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left text-[13px] text-colorText hover:bg-colorFillTertiary"
                            >
                                <Robot
                                    aria-hidden
                                    size={14}
                                    className="shrink-0 text-colorTextSecondary"
                                />
                                <span className="truncate">{agent.name}</span>
                            </button>
                        ))
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}
