import {useMemo, useState} from "react"

import {agentWorkflowsListQueryStateAtom, type Workflow} from "@agenta/entities/workflow"
import {Button, DataTable, type DataTableColumn} from "@agenta/ui/ui"
import {ClockClockwise, Lightning, MagnifyingGlass, Plus, Robot} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {StatusTag, type StatusTone} from "@/components/StatusTag"
import {Input} from "@/components/ui/input"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {
    AUTOMATION_STATUS_LABEL,
    automationStatus,
    runsWhenLabel,
    type Automation,
    type AutomationStatus,
} from "./automationModel"
import {
    AutomationListEmpty,
    AutomationListError,
    AutomationListSkeleton,
} from "./states/AutomationStates"
import {useAutomations} from "./useAutomations"

/** The status pill's tone. Stopped is a choice, so it reads as inert, never as a problem. */
const STATUS_TONE: Record<AutomationStatus, StatusTone> = {
    working: "live",
    paused: "muted",
    // Red, not the accent: a failing automation is a fault to fix, not a nudge to look.
    attention: "failed",
}

// Sums to 544 — the width below which the table scrolls sideways rather than crushing four
// columns into a phone. The identity column is the widest and shares surplus with runs-when and
// agent; status holds its 118 at every width, because a pill does not get wider with the window.
// The min-width is spelled out below rather than derived — Tailwind only sees literal classes.
const COLUMN_WIDTH = {automation: 200, status: 118, runsWhen: 146, agent: 80}

/**
 * The automations list — where the nav's Automations entry lands.
 *
 * One table over both trigger endpoints: a reader sees a list of things that run an agent, not a
 * schedules tab beside a subscriptions tab. Every row answers the four questions in order — what
 * it is, whether it is working, when it runs, and which agent it runs — and the whole row opens
 * the detail screen, because there is nothing else on a row to click.
 */
export const AutomationListScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindProjectContext(projectId)
    const router = useRouter()
    const base = `/w/${workspaceId}/p/${projectId}`
    const [search, setSearch] = useState("")
    const {automations, isLoading, error, refetch} = useAutomations(search)

    // Same roster `useAutomations` already reads for its search, so the name in a row and the
    // name it matched on can never disagree.
    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agentNames = useMemo(
        () =>
            new Map(
                (agentsQuery.data ?? []).map((agent: Workflow) => [
                    agent.id,
                    agent.name || agent.slug || "",
                ]),
            ),
        [agentsQuery.data],
    )

    const columns = useMemo<DataTableColumn<Automation>[]>(
        () => [
            {
                key: "automation",
                title: "Automation",
                width: COLUMN_WIDTH.automation,
                flexible: true,
                render: (automation) => (
                    <span className="flex min-w-0 items-center gap-2">
                        {automation.kind === "event" ? (
                            <Lightning
                                size={14}
                                className="shrink-0 text-muted-foreground"
                                aria-hidden
                            />
                        ) : (
                            <ClockClockwise
                                size={14}
                                className="shrink-0 text-muted-foreground"
                                aria-hidden
                            />
                        )}
                        <span className="truncate font-medium" title={automation.name}>
                            {automation.name}
                        </span>
                    </span>
                ),
            },
            {
                key: "status",
                title: "Status",
                width: COLUMN_WIDTH.status,
                flexible: false,
                render: (automation) => {
                    // Run outcomes land in W6; until then nothing here has failed recently.
                    const status = automationStatus(automation, false)
                    return (
                        <StatusTag tone={STATUS_TONE[status]} dot>
                            {AUTOMATION_STATUS_LABEL[status]}
                        </StatusTag>
                    )
                },
            },
            {
                key: "runsWhen",
                title: "Runs when",
                width: COLUMN_WIDTH.runsWhen,
                flexible: true,
                render: (automation) => {
                    const label = runsWhenLabel(automation)
                    return (
                        <span className="block truncate text-muted-foreground" title={label}>
                            {label}
                        </span>
                    )
                },
            },
            {
                key: "agent",
                title: "Agent",
                width: COLUMN_WIDTH.agent,
                flexible: true,
                render: (automation) => {
                    const name = agentNames.get(automation.agentId ?? "")?.trim()
                    if (!name) return <span className="text-muted-foreground">—</span>
                    return (
                        <span className="flex min-w-0 items-center gap-1.5">
                            <Robot
                                size={14}
                                className="shrink-0 text-muted-foreground"
                                aria-hidden
                            />
                            <span className="truncate" title={name}>
                                {name}
                            </span>
                        </span>
                    )
                },
            },
        ],
        [agentNames],
    )

    const term = search.trim()
    const isEmpty = !isLoading && !error && automations.length === 0

    const body = (() => {
        if (isLoading) return <AutomationListSkeleton />
        if (error) return <AutomationListError onRetry={refetch} />
        if (isEmpty && !term)
            return (
                <AutomationListEmpty
                    onSelectTemplate={(template) =>
                        void router.push(`${base}/automations/new?template=${template.id}`)
                    }
                />
            )
        return (
            <DataTable<Automation>
                columns={columns}
                rows={automations}
                rowKey={(automation) => automation.id}
                columnSettings={false}
                onRowClick={(automation) =>
                    void router.push(`${base}/automations/${automation.id}`)
                }
                empty={
                    <p className="m-0 text-center text-sm text-muted-foreground">
                        Nothing matches “{term}”.
                    </p>
                }
                className="[&_table]:min-w-[544px]"
            />
        )
    })()

    return (
        <>
            <PageTitle title="Automations" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div className="flex shrink-0 flex-col gap-3 border-0 border-b border-solid border-border px-6 pb-3 pt-2 lg:px-16 lg:pt-14">
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                {/* Same title ramp the other browse screens use: the body rung on
                                    a phone, the desktop page-title rung from `sm`. */}
                                <h1 className="text-colorText m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] sm:text-[24px] sm:leading-[1.3333333333333333]">
                                    Automations
                                </h1>
                                <Button
                                    onClick={() => void router.push(`${base}/automations/new`)}
                                    className="h-control-sm shrink-0 rounded-control-sm px-btn-sm text-btn-sm sm:h-control sm:rounded-control sm:px-btn sm:text-btn-md"
                                >
                                    <Plus size={14} />
                                    New automation
                                </Button>
                            </div>

                            <div className="relative w-full max-w-md">
                                <MagnifyingGlass
                                    size={14}
                                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                                    aria-hidden
                                />
                                <Input
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Search automations"
                                    aria-label="Search automations"
                                    className="pl-8"
                                />
                            </div>
                        </div>
                    }
                >
                    <div className="min-w-0 px-6 pb-6 pt-4 lg:px-16">{body}</div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
