import {useCallback, useMemo, useState} from "react"

import {
    agentLabel,
    AutomationLastRunCell,
    AutomationListEmpty,
    AutomationListError,
    AutomationListNoMatch,
    automationStatus,
    type Automation,
    type AutomationListView,
    DEFAULT_AUTOMATION_LIST_VIEW,
    deriveAutomationList,
    isDefaultAutomationListView,
    runsWhenLabel,
    useAutomations,
} from "@agenta/automation-ui"
import {AgentChip} from "@agenta/entity-ui/agent"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {useFilterMenuView} from "@agenta/ui/filter-menu"
import {useMediaQuery} from "@agenta/ui/hooks"
import {
    ListTable,
    ListTableToolbar,
    ListTableViewToggle,
    type ListTableColumn,
} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {AutomationActionsMenu} from "./AutomationActionsMenu"
import {AutomationCardBody} from "./AutomationCardBody"
import {AutomationFilterMenu} from "./AutomationFilterMenu"
import {AutomationKindMark} from "./AutomationKindMark"
import {AutomationStatusMark} from "./AutomationStatusMark"

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
 * the detail screen, because there is nothing else on a row to click. The frame's card view
 * stacks the same four answers, switched from the toolbar as on skills.
 *
 * The shared `ListTable` rather than the `DataTable`: this table's column distribution is
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
    // Grouping and the view mode are how a reader chose to read the list; the filters are a
    // question they were asking at the time, so only the first two survive a reload.
    const [view, setView] = useFilterMenuView<AutomationListView>({
        key: "agenta:automations:view",
        fallback: DEFAULT_AUTOMATION_LIST_VIEW,
        persist: ["group", "mode"],
    })
    const setMode = useCallback(
        (mode: AutomationListView["mode"]) => setView({...view, mode}),
        [setView, view],
    )
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
    // The rows label from the same names the search matched on, so the two can never disagree.
    const {automations, isLoading, error, refetch, agentNames, agentsReady} = useAutomations(search)

    // The menu's Agent row offers the same roster the rows label from, named the same way.
    const agents = useMemo(
        () =>
            [...agentNames]
                .map(([id, name]) => ({id, name: name.trim()}))
                .filter((agent) => agent.id && agent.name),
        [agentNames],
    )

    // The Agent cell's label, resolved the same way for a row and a card.
    const agentName = useCallback(
        (automation: Automation) =>
            agentLabel(
                automation.agentId,
                agentNames.get(automation.agentId ?? "")?.trim() || null,
                agentsReady,
            ),
        [agentNames, agentsReady],
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
                view={view.mode}
                // A card holds a status line, a cadence and an agent; narrower than this the
                // cadence wraps and the grid reads as a wall of text.
                cardMinWidth={300}
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
                                      : // The mode survives: it is how the reader chose to
                                        // read the list, not what they narrowed it to.
                                        () =>
                                            setView({
                                                ...DEFAULT_AUTOMATION_LIST_VIEW,
                                                mode: view.mode,
                                            })
                            }
                        />
                    )
                }
                renderCard={(automation) => (
                    <AutomationCardBody
                        automation={automation}
                        agentName={agentName(automation)}
                        base={base}
                    />
                )}
                renderRow={(automation) => {
                    // Run outcomes land in W6; until then nothing here has failed.
                    const status = automationStatus(automation, false)
                    const runsWhen = runsWhenLabel(automation)
                    const name = agentName(automation)

                    return (
                        <>
                            <span className="flex min-w-0 items-center gap-2">
                                <AutomationKindMark kind={automation.kind} />
                                <span
                                    className="truncate text-[14px] text-foreground"
                                    title={automation.name}
                                >
                                    {automation.name}
                                </span>
                            </span>

                            {narrow ? null : <AutomationStatusMark status={status} />}

                            {narrow ? null : (
                                <span
                                    className="block truncate text-[13px] text-muted-foreground"
                                    title={runsWhen}
                                >
                                    {runsWhen}
                                </span>
                            )}

                            <AutomationLastRunCell automation={automation} />

                            {narrow ? null : name ? (
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
                                        title={name}
                                    >
                                        {name}
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
                                    aria-label="New automation"
                                    // Square icon button on a phone, where the label is hidden.
                                    className="max-sm:size-8 max-sm:px-0"
                                    onClick={() => void router.push(`${base}/automations/new`)}
                                >
                                    <Plus />
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
                            inside it, so the bar stays a search bar. The view switch takes the
                            far edge, where it changes how the results are drawn rather than
                            which ones are. */}
                        <ListTableToolbar
                            search={search}
                            onSearchChange={setSearch}
                            searchPlaceholder="Search automations"
                            actions={
                                <>
                                    <AutomationFilterMenu
                                        view={view}
                                        onChange={setView}
                                        agents={agents}
                                    />
                                    <ListTableViewToggle
                                        value={view.mode}
                                        onChange={setMode}
                                        className="ml-auto"
                                    />
                                </>
                            }
                        />
                        {body}
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
