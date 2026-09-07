import {useMemo, useState} from "react"

import {agentWorkflowsListQueryStateAtom, type Workflow} from "@agenta/entities/workflow"
import {ClockClockwise, Lightning, MagnifyingGlass, Plus, Robot} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {Button} from "@/components/ui/button"
import {Input} from "@/components/ui/input"
import {FOCUS_RING} from "@/lib/interactive"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {
    agentLabel,
    AUTOMATION_STATUS_LABEL,
    automationStatus,
    runsWhenLabel,
    type AutomationStatus,
} from "./automationModel"
import {
    AutomationListEmpty,
    AutomationListError,
    AutomationListSkeleton,
} from "./states/AutomationStates"
import {useAutomations} from "./useAutomations"

/**
 * The status cell's colour. A bare dot and a coloured word, never a pill: the status column is
 * read down, and four pills in a column read as four buttons. Stopped is a choice, so it reads
 * as inert; red, not the accent, is reserved for a fault to fix.
 */
const STATUS_COLOR: Record<AutomationStatus, {dot: string; text: string}> = {
    working: {dot: "bg-success", text: "text-success"},
    paused: {dot: "bg-muted-foreground", text: "text-muted-foreground"},
    attention: {dot: "bg-destructive", text: "text-destructive"},
}

/**
 * The four columns, shared by the header row and every body row so the two can never drift.
 *
 * The identity column is the widest and shares surplus with runs-when and agent; status holds
 * its 118 at every width, because a status word does not get wider with the window. The minima
 * sum to 544 — the width below which the table scrolls sideways rather than crushing four
 * columns into a phone.
 */
const GRID =
    "grid gap-3 [grid-template-columns:minmax(120px,1.7fr)_118px_minmax(120px,1.5fr)_minmax(80px,1fr)]"

/**
 * The automations list — where the nav's Automations entry lands.
 *
 * One table over both trigger endpoints: a reader sees a list of things that run an agent, not a
 * schedules tab beside a subscriptions tab. Every row answers the four questions in order — what
 * it is, whether it is working, when it runs, and which agent it runs — and the whole row opens
 * the detail screen, because there is nothing else on a row to click.
 *
 * A hand-built CSS grid rather than the shared `DataTable`: this table's column distribution is
 * `minmax()`/`fr`, its cells carry no vertical rules, and its rows pad 13/14 — none of which the
 * shared table's fixed `<colgroup>` layout and 8px cells can express without being overridden
 * everywhere.
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
            <div className="overflow-hidden rounded-xl border border-solid border-border">
                <div className="overflow-x-auto">
                    <div className="min-w-[544px]">
                        <div
                            className={`${GRID} border-0 border-b border-solid border-border bg-muted/40 px-3.5 py-[9px] text-[12px] text-muted-foreground`}
                        >
                            <span>Automation</span>
                            <span>Status</span>
                            <span>Runs when</span>
                            <span>Agent</span>
                        </div>

                        {automations.length === 0 ? (
                            <p className="m-0 p-[34px] text-center text-[13px] text-muted-foreground">
                                Nothing matches “{term}”.
                            </p>
                        ) : (
                            automations.map((automation) => {
                                // Run outcomes land in W6; until then nothing here has failed.
                                const status = automationStatus(automation, false)
                                const color = STATUS_COLOR[status]
                                const runsWhen = runsWhenLabel(automation)
                                const agentName = agentLabel(
                                    automation.agentId,
                                    agentNames.get(automation.agentId ?? "")?.trim() || null,
                                    !agentsQuery.isPending,
                                )

                                return (
                                    <button
                                        key={automation.id}
                                        type="button"
                                        onClick={() =>
                                            void router.push(`${base}/automations/${automation.id}`)
                                        }
                                        className={`${GRID} w-full cursor-pointer items-center border-0 border-b border-solid border-border bg-transparent px-3.5 py-[13px] text-left last:border-b-0 hover:bg-accent ${FOCUS_RING}`}
                                    >
                                        <span className="flex min-w-0 items-center gap-2">
                                            {automation.kind === "event" ? (
                                                <Lightning
                                                    size={15}
                                                    className="shrink-0 text-muted-foreground"
                                                    aria-hidden
                                                />
                                            ) : (
                                                <ClockClockwise
                                                    size={15}
                                                    className="shrink-0 text-muted-foreground"
                                                    aria-hidden
                                                />
                                            )}
                                            <span
                                                className="truncate text-[14px] font-medium text-foreground"
                                                title={automation.name}
                                            >
                                                {automation.name}
                                            </span>
                                        </span>

                                        <span className="flex min-w-0 items-center gap-[7px]">
                                            <span
                                                aria-hidden
                                                className={`size-1.5 shrink-0 rounded-full ${color.dot}`}
                                            />
                                            <span className={`text-[13px] ${color.text}`}>
                                                {AUTOMATION_STATUS_LABEL[status]}
                                            </span>
                                        </span>

                                        <span
                                            className="block truncate text-[13px] text-muted-foreground"
                                            title={runsWhen}
                                        >
                                            {runsWhen}
                                        </span>

                                        {agentName ? (
                                            <span className="flex min-w-0 items-center gap-1.5">
                                                <Robot
                                                    size={13}
                                                    className="shrink-0 text-muted-foreground"
                                                    aria-hidden
                                                />
                                                <span
                                                    className="truncate text-[13px] text-foreground"
                                                    title={agentName}
                                                >
                                                    {agentName}
                                                </span>
                                            </span>
                                        ) : (
                                            <span className="text-[13px] text-muted-foreground">
                                                —
                                            </span>
                                        )}
                                    </button>
                                )
                            })
                        )}
                    </div>
                </div>
            </div>
        )
    })()

    return (
        <>
            <PageTitle title="Automations" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div className="mx-auto w-full max-w-[1180px] shrink-0 px-8 pb-3 pt-7">
                            <div className="mb-1.5 flex min-w-0 items-center gap-4">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <h1 className="m-0 min-w-0 flex-1 truncate text-[26px] font-semibold leading-[1.2] tracking-[-0.02em] text-foreground">
                                    Automations
                                </h1>
                                <Button
                                    size="sm"
                                    className="font-normal"
                                    onClick={() => void router.push(`${base}/automations/new`)}
                                >
                                    <Plus />
                                    New automation
                                </Button>
                            </div>

                            <div className="flex items-center gap-2.5">
                                <label className="flex min-w-[200px] max-w-[340px] flex-1 items-center gap-2 rounded-lg border border-solid border-border px-2.5 py-[7px] focus-within:border-ring">
                                    <MagnifyingGlass
                                        size={14}
                                        className="shrink-0 text-muted-foreground"
                                        aria-hidden
                                    />
                                    <Input
                                        value={search}
                                        onChange={(event) => setSearch(event.target.value)}
                                        placeholder="Search automations"
                                        aria-label="Search automations"
                                        className="h-auto rounded-none border-0 bg-transparent p-0 text-[13px] shadow-none focus-visible:border-0 focus-visible:ring-0 md:text-[13px]"
                                    />
                                </label>
                            </div>
                        </div>
                    }
                >
                    <div className="mx-auto w-full min-w-0 max-w-[1180px] px-8 pb-12">{body}</div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
