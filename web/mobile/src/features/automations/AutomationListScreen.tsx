import {Fragment, useCallback, useMemo, useState} from "react"

import {
    agentLabel,
    AUTOMATION_STATUS_LABEL,
    AutomationListEmpty,
    AutomationListError,
    AutomationListNoMatch,
    AutomationListSkeleton,
    automationStatus,
    type AutomationStatus,
    type AutomationListView,
    DEFAULT_AUTOMATION_LIST_VIEW,
    deriveAutomationList,
    isDefaultAutomationListView,
    runsWhenLabel,
    useAutomations,
} from "@agenta/automation-ui"
import {agentWorkflowsListQueryStateAtom, type Workflow} from "@agenta/entities/workflow"
import {AgentGlyph} from "@agenta/entity-ui/agent"
import {useFilterMenuView} from "@agenta/ui/filter-menu"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {
    CaretDown,
    ClockClockwise,
    Lightning,
    MagnifyingGlass,
    Plus,
    Robot,
} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {Button} from "@/components/ui/button"
import {InputGroup, InputGroupAddon, InputGroupInput} from "@/components/ui/input-group"
import {FOCUS_RING} from "@/lib/interactive"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {AutomationActionsMenu} from "./AutomationActionsMenu"
import {AutomationFilterMenu} from "./AutomationFilterMenu"

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
 * Identity takes twice the share of the other three, which split the rest equally — status held
 * a fixed 118 before, so the gap after it grew while the others' did not and the three read as
 * unevenly spaced. The last column is the row's kebab, fixed at the button's own width so the
 * reading columns keep their proportions. The minima plus gaps sum to 572 — the width below
 * which the table scrolls sideways rather than crushing five columns into a phone.
 */
/**
 * The page column, shared with the sessions page: same max width, same gutters, so a reader
 * moving between the two nav entries sees one page frame rather than two.
 */
const PAGE_FRAME = `${pageContentWidthClass} lg:px-16`

const GRID =
    "grid gap-3 [grid-template-columns:minmax(140px,2fr)_minmax(110px,1fr)_minmax(130px,1fr)_minmax(120px,1fr)_24px]"

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
    // Grouping is a display preference a reader sets once; the filters are a question they were
    // asking at the time, so only the first survives a reload.
    const [view, setView] = useFilterMenuView<AutomationListView>({
        key: "agenta:automations:view",
        fallback: DEFAULT_AUTOMATION_LIST_VIEW,
        persist: ["group"],
    })
    // Group headings carry a chevron, so it has to do something: collapsed keys, not a flag per
    // group, because the groups themselves come and go as the view changes.
    const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
    const toggleGroup = useCallback(
        (key: string) =>
            setCollapsed((current) => {
                const next = new Set(current)
                if (!next.delete(key)) next.add(key)
                return next
            }),
        [],
    )
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

    // The menu's Agent row offers the same roster the rows label from, named the same way.
    const agents = useMemo(
        () =>
            (agentsQuery.data ?? [])
                .map((agent: Workflow) => ({
                    id: agent.id,
                    name: (agent.name || agent.slug || "").trim(),
                }))
                .filter((agent: {id: string; name: string}) => agent.id && agent.name),
        [agentsQuery.data],
    )

    const term = search.trim()
    const isEmpty = !isLoading && !error && automations.length === 0
    const groups = useMemo(
        () => deriveAutomationList(automations, view, agentNames),
        [agentNames, automations, view],
    )
    const matchCount = groups.reduce((total, group) => total + group.automations.length, 0)

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
            <div className="overflow-x-auto">
                    <div className="min-w-[572px]">
                        <div
                            className={`${GRID} mb-1 border-0 border-b border-solid border-border px-2 py-2 text-[12px] font-medium text-muted-foreground`}
                        >
                            <span>Automation</span>
                            <span>Status</span>
                            <span>Runs when</span>
                            <span>Agent</span>
                            <span className="sr-only">Actions</span>
                        </div>

                        {matchCount === 0 ? (
                            <AutomationListNoMatch
                                term={term || undefined}
                                onClear={
                                    term
                                        ? () => setSearch("")
                                        : isDefaultAutomationListView(view)
                                          ? undefined
                                          : () => setView(DEFAULT_AUTOMATION_LIST_VIEW)
                                }
                            />
                        ) : (
                            groups.map((group) => (
                                <Fragment key={group.key}>
                                    {/* `Group by: None` returns one unlabelled group, so the
                                        table is byte-for-byte what it was before grouping. */}
                                    {group.label === null ? null : (
                                        <button
                                            type="button"
                                            onClick={() => toggleGroup(group.key)}
                                            aria-expanded={!collapsed.has(group.key)}
                                            className={`box-border flex w-full cursor-pointer appearance-none items-center gap-1.5 border-0 bg-transparent px-2 pb-1.5 pt-3.5 text-left font-[inherit] text-[13px] text-muted-foreground hover:text-foreground ${FOCUS_RING}`}
                                        >
                                            <span>{group.label}</span>
                                            <CaretDown
                                                size={12}
                                                aria-hidden
                                                className={`shrink-0 transition-transform ${collapsed.has(group.key) ? "-rotate-90" : ""}`}
                                            />
                                        </button>
                                    )}
                                    {(collapsed.has(group.key) ? [] : group.automations).map((automation) => {
                                        // Run outcomes land in W6; until then nothing here has failed.
                                        const status = automationStatus(automation, false)
                                        const color = STATUS_COLOR[status]
                                        const runsWhen = runsWhenLabel(automation)
                                        const agentName = agentLabel(
                                            automation.agentId,
                                            agentNames.get(automation.agentId ?? "")?.trim() ||
                                                null,
                                            !agentsQuery.isPending,
                                        )

                                        const open = () =>
                                            void router.push(`${base}/automations/${automation.id}`)

                                        return (
                                            // Not a <button>: the row carries a kebab of its own, and a
                                            // button inside a button is invalid HTML that browsers repair
                                            // by dropping one of them.
                                            <div
                                                key={automation.id}
                                                role="button"
                                                tabIndex={0}
                                                onClick={open}
                                                onKeyDown={(event) => {
                                                    if (event.key !== "Enter" && event.key !== " ")
                                                        return
                                                    event.preventDefault()
                                                    open()
                                                }}
                                                className={`${GRID} w-full cursor-pointer items-center rounded-md border-0 bg-transparent px-2 py-[13px] text-left hover:bg-accent/60 ${FOCUS_RING}`}
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
                                                        className="truncate text-[14px] text-foreground"
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
                                                        {/* The agent's own glyph, not a generic robot —
                                                    a column of identical icons identifies
                                                    nothing. */}
                                                        <AgentGlyph
                                                            workflowId={automation.agentId}
                                                            size={13}
                                                            fallback={
                                                                <Robot size={13} aria-hidden />
                                                            }
                                                            className="shrink-0"
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

                                                {/* The menu's own clicks are not the row's: without this
                                            every menu press would also open the detail screen. */}
                                                <span
                                                    className="flex justify-end"
                                                    onClick={(event) => event.stopPropagation()}
                                                    onKeyDown={(event) => event.stopPropagation()}
                                                >
                                                    <AutomationActionsMenu
                                                        automation={automation}
                                                        base={base}
                                                        surface="list"
                                                    />
                                                </span>
                                            </div>
                                        )
                                    })}
                                </Fragment>
                            ))
                        )}
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
                        // The same frame the sessions bar uses, so the two pages line up at every
                        // width: page column, 16px gutters on a phone, 64px and a deeper top
                        // from `lg`.
                        <div
                            className={`box-border shrink-0 px-4 pb-3 pt-3 lg:pt-14 ${PAGE_FRAME}`}
                        >
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px] sm:leading-[1.3333333333333333]">
                                    Automations
                                </h1>
                                <Button
                                    size="sm"
                                    aria-label="New automation"
                                    className="text-xs font-normal"
                                    onClick={() => void router.push(`${base}/automations/new`)}
                                >
                                    <Plus className="size-3" />
                                    {/* The label costs more than it earns at phone width: it
                                        pushed the page's own title into an ellipsis. */}
                                    <span className="hidden sm:inline">New automation</span>
                                </Button>
                            </div>
                        </div>
                    }
                >
                    <div className={`min-w-0 px-4 pb-12 pt-3 ${PAGE_FRAME}`}>
                        {/* Search belongs to the list, not to the page: it sits on the table's
                            own left edge so it reads as the control that narrows what is below
                            it. */}
                        {/* One control beside the field, not three: sort and group are rows
                            inside it, so the bar stays a search bar. */}
                        <div className="mb-3 flex items-center gap-2">
                            {/* h-8 matches the filter button beside it; the group's own 36 is a
                                form field's height, not a toolbar's. */}
                            {/* The group's own tinted fill sits a shade off the page; this field is part of the
                                page, not a raised control on it. */}
                            <InputGroup className="h-8 min-w-0 max-w-[340px] flex-1 bg-transparent dark:bg-transparent">
                                <InputGroupAddon>
                                    <MagnifyingGlass size={14} aria-hidden />
                                </InputGroupAddon>
                                <InputGroupInput
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Search automations"
                                    aria-label="Search automations"
                                    className="text-[13px] md:text-[13px]"
                                />
                            </InputGroup>
                            <AutomationFilterMenu view={view} onChange={setView} agents={agents} />
                        </div>
                        {body}
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}

