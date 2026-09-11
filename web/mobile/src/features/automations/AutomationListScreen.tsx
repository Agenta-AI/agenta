import {useCallback, useMemo, useState} from "react"

import {
    agentLabel,
    AUTOMATION_STATUS_LABEL,
    AutomationLastRunCell,
    AutomationListEmpty,
    AutomationListError,
    AutomationListNoMatch,
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
import {AgentChip} from "@agenta/entity-ui/agent"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {useFilterMenuView} from "@agenta/ui/filter-menu"
import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, ListTableToolbar, type ListTableColumn} from "@agenta/ui/list-table"
import {ClockClockwise, Lightning, Plus} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {Button} from "@/components/ui/button"

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

/** The kind mark's tile. Preset pairs, so both halves flip with the theme. */
const KIND_CHIP: Record<"event" | "schedule", string> = {
    event: "bg-[var(--ag-preset-orange-bg)] text-[var(--ag-preset-orange-text)]",
    schedule: "bg-[var(--ag-preset-purple-bg)] text-[var(--ag-preset-purple-text)]",
}

const NAME_COLUMN: ListTableColumn = {key: "name", label: "Automation", width: "minmax(140px,2fr)"}
const LAST_RUN_COLUMN: ListTableColumn = {
    key: "lastRun",
    label: "Last run",
    width: "minmax(110px,0.9fr)",
}
const ACTIONS_COLUMN: ListTableColumn = {
    key: "actions",
    label: "Actions",
    srOnly: true,
    width: "24px",
}

const WIDE_COLUMNS: ListTableColumn[] = [
    NAME_COLUMN,
    {key: "status", label: "Status", width: "minmax(100px,0.8fr)"},
    {key: "runsWhen", label: "Runs when", width: "minmax(130px,1fr)"},
    LAST_RUN_COLUMN,
    {key: "agent", label: "Agent", width: "minmax(120px,1fr)"},
    ACTIONS_COLUMN,
]
// A phone keeps the name and whether it is doing anything; the kind tile already says schedule
// or event, and status, cadence and agent wait on the detail screen.
const NARROW_COLUMNS: ListTableColumn[] = [NAME_COLUMN, LAST_RUN_COLUMN, ACTIONS_COLUMN]

/** The sessions table's line, so the two nav entries slim down at the same width. */
const WIDE_QUERY = "(min-width: 640px)"
const WIDE_MIN_WIDTH = 680
const NARROW_MIN_WIDTH = 300

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
    const narrow = !useMediaQuery(WIDE_QUERY)
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

    const body = (() => {
        if (error) return <AutomationListError onRetry={refetch} />

        return (
            <ListTable
                columns={narrow ? NARROW_COLUMNS : WIDE_COLUMNS}
                minWidth={narrow ? NARROW_MIN_WIDTH : WIDE_MIN_WIDTH}
                loading={isLoading}
                groups={groups.map((group) => ({
                    key: group.key,
                    label: group.label,
                    rows: group.automations,
                }))}
                rowKey={(automation) => automation.id}
                onOpenRow={(automation) => void router.push(`${base}/automations/${automation.id}`)}
                collapsedKeys={collapsed}
                onToggleGroup={toggleGroup}
                empty={
                    // The columns stay true whether the project has no automations or a filter
                    // hid them all, so both states sit UNDER the header rather than replacing the
                    // table — what is missing is rows.
                    // `isEmpty` alone is not "this project has none": the search narrows the
                    // query itself, so a term that matches nothing empties the list too.
                    isEmpty && !term && isDefaultAutomationListView(view) ? (
                        <AutomationListEmpty />
                    ) : (
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
                    )
                }
                renderRow={(automation) => {
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
                        <>
                            <span className="flex min-w-0 items-center gap-2">
                                {/* A tile, like the agent's beside it, so the two marks on a row
                                    read as the same kind of thing. The two kinds get their own
                                    tint: at a glance down the column, colour separates "when
                                    something happens" from "on a schedule" faster than two
                                    small glyphs do. */}
                                <span
                                    className={`flex size-7 shrink-0 items-center justify-center rounded-md ${KIND_CHIP[automation.kind]}`}
                                >
                                    {automation.kind === "event" ? (
                                        <Lightning size={15} aria-hidden />
                                    ) : (
                                        <ClockClockwise size={15} aria-hidden />
                                    )}
                                </span>
                                <span
                                    className="truncate text-[14px] text-foreground"
                                    title={automation.name}
                                >
                                    {automation.name}
                                </span>
                            </span>

                            {narrow ? null : (
                                <span className="flex min-w-0 items-center gap-[7px]">
                                    <span
                                        aria-hidden
                                        className={`size-1.5 shrink-0 rounded-full ${color.dot}`}
                                    />
                                    <span className={`text-[13px] ${color.text}`}>
                                        {AUTOMATION_STATUS_LABEL[status]}
                                    </span>
                                </span>
                            )}

                            {narrow ? null : (
                                <span
                                    className="block truncate text-[13px] text-muted-foreground"
                                    title={runsWhen}
                                >
                                    {runsWhen}
                                </span>
                            )}

                            <AutomationLastRunCell automation={automation} />

                            {narrow ? null : agentName ? (
                                <span className="flex min-w-0 items-center gap-1.5">
                                    {/* The agent's own mark, not a generic robot — a column of
                                        identical icons identifies nothing. Same tile the agent
                                        picker draws, so the row and the control that set it
                                        match. */}
                                    <AgentChip
                                        workflowId={automation.agentId}
                                        box="size-5"
                                        glyph={13}
                                    />
                                    <span
                                        className="truncate text-[13px] text-foreground"
                                        title={agentName}
                                    >
                                        {agentName}
                                    </span>
                                </span>
                            ) : (
                                <span className="text-[13px] text-muted-foreground">—</span>
                            )}

                            {/* The menu's own clicks are not the row's: without this every menu
                                press would also open the detail screen. */}
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
                        </>
                    )
                }}
            />
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
                        <ListTableToolbar
                            search={search}
                            onSearchChange={setSearch}
                            searchPlaceholder="Search automations"
                            actions={
                                <AutomationFilterMenu
                                    view={view}
                                    onChange={setView}
                                    agents={agents}
                                />
                            }
                        />
                        {body}
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
