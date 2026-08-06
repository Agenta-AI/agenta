import {
    sessionAgentFilterAtom,
    sessionSearchAtom,
    sessionShowArchivedAtom,
    sessionShowTriggeredAtom,
    sessionStatusFilterAtom,
    type SessionStatusFilter,
} from "@agenta/sessions/state"
import {MagnifyingGlassIcon} from "@phosphor-icons/react"
import {Input, Select, Switch, Tooltip, Typography} from "antd"
import {useAtom, useAtomValue} from "jotai"

import {agentsWorkflowsAtom} from "../../agents/store"

const STATUSES: {value: SessionStatusFilter; label: string}[] = [
    {value: "all", label: "All sessions"},
    {value: "live", label: "Live"},
    {value: "waiting", label: "Waiting on you"},
]

const RailLabel = ({children}: {children: React.ReactNode}) => (
    <h2 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-colorTextTertiary">
        {children}
    </h2>
)

interface Props {
    title: string
    waitingCount: number | undefined
    /** The agent-scoped page fixes the agent from the route, so the picker would only lie. */
    hideAgentFilter?: boolean
}

/**
 * The session filters as a rail.
 *
 * They had outgrown a toolbar: five dimensions on one row, two of them unlabelled switches, and
 * nowhere to put the ones still coming (date range, origin, trigger). Vertically each gets a label
 * and a group, and the status choice becomes a list you read rather than a segmented control you
 * decode. Every control still maps to the same atom, and so to the same server predicate.
 */
const SessionFiltersRail = ({title, waitingCount, hideAgentFilter}: Props) => {
    const [search, setSearch] = useAtom(sessionSearchAtom)
    const [agentId, setAgentId] = useAtom(sessionAgentFilterAtom)
    const [status, setStatus] = useAtom(sessionStatusFilterAtom)
    const [showArchived, setShowArchived] = useAtom(sessionShowArchivedAtom)
    const [showTriggered, setShowTriggered] = useAtom(sessionShowTriggeredAtom)
    const agents = useAtomValue(agentsWorkflowsAtom)

    return (
        <aside className="box-border flex w-full shrink-0 flex-col gap-6 overflow-y-auto border-0 border-solid border-colorBorderSecondary px-6 py-6 lg:w-[280px] lg:border-r lg:bg-colorFillQuaternary">
            <Typography.Title level={2} className="!m-0 !text-[24px] !leading-tight">
                {title}
            </Typography.Title>

            <Input
                allowClear
                value={search}
                placeholder="Search sessions"
                prefix={<MagnifyingGlassIcon size={14} className="text-colorTextTertiary" />}
                onChange={(event) => setSearch(event.target.value)}
            />

            <nav className="flex flex-col gap-0.5">
                {STATUSES.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => setStatus(option.value)}
                        className={`box-border flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 px-3 py-2 text-left text-sm transition-colors ${
                            option.value === status
                                ? "bg-colorFillSecondary text-colorText"
                                : "bg-transparent text-colorTextSecondary hover:bg-colorFillQuaternary"
                        }`}
                    >
                        <span className="min-w-0 flex-1 truncate">{option.label}</span>
                        {option.value === "waiting" && waitingCount ? (
                            <span className="shrink-0 rounded bg-colorWarningBg px-1.5 py-0.5 text-[11px] leading-none text-colorWarningText">
                                {waitingCount}
                            </span>
                        ) : null}
                    </button>
                ))}
            </nav>

            {hideAgentFilter ? null : (
                <section className="flex flex-col gap-2">
                    <RailLabel>Agent</RailLabel>
                    <Select
                        allowClear
                        value={agentId}
                        onChange={(value) => setAgentId(value ?? null)}
                        placeholder="All agents"
                        options={agents.map((agent) => ({
                            value: agent.workflowId,
                            label: agent.name,
                        }))}
                    />
                </section>
            )}

            {/* Two different kinds of switch, so two headings: one picks WHICH sessions, the
                other widens the set. Under one "Include" label they read as the same thing. */}
            <section className="flex flex-col gap-3">
                <RailLabel>Show</RailLabel>
                <Tooltip
                    title="Runs started by an automation, instead of the sessions you started"
                    placement="right"
                >
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-colorTextSecondary">
                        <Switch checked={showTriggered} onChange={setShowTriggered} />
                        Automation runs
                    </label>
                </Tooltip>
            </section>

            <section className="flex flex-col gap-3">
                <RailLabel>Include</RailLabel>
                <Tooltip title="Archived sessions are hidden but recoverable" placement="right">
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-colorTextSecondary">
                        <Switch checked={showArchived} onChange={setShowArchived} />
                        Archived
                    </label>
                </Tooltip>
            </section>
        </aside>
    )
}

export default SessionFiltersRail
