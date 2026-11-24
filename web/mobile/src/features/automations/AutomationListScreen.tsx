import {useCallback, useMemo, useState} from "react"

import {
    agentLabel,
    AutomationLastRunCell,
    AutomationListNoMatch,
    automationStatus,
    type Automation,
    type AutomationListView,
    DEFAULT_AUTOMATION_LIST_VIEW,
    deriveAutomationList,
    isDefaultAutomationListView,
    runsWhenLabel,
    useAutomations,
    useAutomationText,
} from "@agenta/automation-ui"
import {AgentChip} from "@agenta/entity-ui/agent"
import {useT} from "@agenta/i18n"
import automationsScreensCatalog from "@agenta/i18n/catalogs/automations.screens"
import {LoadError} from "@agenta/ui/components/presentational"
import {useFilterMenuView} from "@agenta/ui/filter-menu"
import {useMediaQuery} from "@agenta/ui/hooks"
import {
    LIST_COLUMN_WIDTH,
    ListTable,
    ListTableNameCell,
    ListTableToolbar,
    ListTableViewToggle,
    type ListTableColumn,
} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"
import {useRouter} from "next/router"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {FeatureOnboarding} from "../education/FeatureOnboarding"
import {HowThisWorksButton} from "../education/HowThisWorksButton"
import {PageLayout} from "../page-layout/PageLayout"

import {AutomationActionsMenu} from "./AutomationActionsMenu"
import {AutomationAgentStarters} from "./AutomationAgentStarters"
import {AutomationCardBody} from "./AutomationCardBody"
import {AutomationFilterMenu} from "./AutomationFilterMenu"
import {AutomationKindMark} from "./AutomationKindMark"
import {AutomationStatusMark} from "./AutomationStatusMark"

/**
 * The columns, shared by the header row and every body row so the two can never drift.
 *
 * Identity takes the largest share and carries Runs when as its meta line. The last
 * column is the row's kebab, fixed at the button's own width so the reading columns keep their
 * proportions. The minima plus gaps sum to 598 — the width below
 * which the table scrolls sideways rather than crushing five columns into a phone.
 */

type ScreenText = ReturnType<typeof useT<[typeof automationsScreensCatalog]>>

const wideColumns = (t: ScreenText): ListTableColumn[] => [
    nameColumn(t),
    {
        key: "status",
        label: t("automations.screens.columnStatus"),
        width: LIST_COLUMN_WIDTH.secondary,
    },
    lastRunColumn(t),
    {key: "agent", label: t("automations.screens.columnAgent"), width: "minmax(160px,1.4fr)"},
    actionsColumn(t),
]
// A phone keeps the name and whether it is doing anything; the kind tile already says schedule
// or event, and status, cadence and agent wait on the detail screen.
const narrowColumns = (t: ScreenText): ListTableColumn[] => [
    nameColumn(t),
    lastRunColumn(t),
    actionsColumn(t),
]
const nameColumn = (t: ScreenText): ListTableColumn => ({
    key: "name",
    label: t("automations.screens.columnAutomation"),
    width: LIST_COLUMN_WIDTH.primary,
})
const lastRunColumn = (t: ScreenText): ListTableColumn => ({
    key: "lastRun",
    label: t("automations.screens.columnLastRun"),
    width: "minmax(110px,1fr)",
})
const actionsColumn = (t: ScreenText): ListTableColumn => ({
    key: "actions",
    label: t("automations.screens.columnActions"),
    srOnly: true,
    width: LIST_COLUMN_WIDTH.actions,
})

/** The sessions table's line, so the two nav entries slim down at the same width. */
const WIDE_QUERY = "(min-width: 640px)"
const WIDE_MIN_WIDTH = 620
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
    const t = useT(automationsScreensCatalog)
    useAutomationText()
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
    // Filters narrow client-side, so with no search term an empty list means the project has none.
    const projectEmpty = isEmpty && !term
    const groups = useMemo(
        () => deriveAutomationList(automations, view, agentNames),
        // The group headings are text, so the groups are cut again when the language changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [agentNames, automations, t, view],
    )

    const body = (() => {
        if (error)
            return (
                <LoadError framed title={t("automations.screens.loadFailed")} onRetry={refetch} />
            )

        return (
            <ListTable
                columns={narrow ? narrowColumns(t) : wideColumns(t)}
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
                showGroupCount
                empty={
                    // The project has automations; the search or the filters hid them.
                    <AutomationListNoMatch
                        term={term || undefined}
                        onClear={
                            term
                                ? () => setSearch("")
                                : isDefaultAutomationListView(view)
                                  ? undefined
                                  : // The mode survives: it is how the reader chose to read the
                                    // list, not what they narrowed it to.
                                    () =>
                                        setView({
                                            ...DEFAULT_AUTOMATION_LIST_VIEW,
                                            mode: view.mode,
                                        })
                        }
                    />
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
                            <ListTableNameCell
                                mark={<AutomationKindMark kind={automation.kind} size={32} />}
                                title={automation.name}
                                meta={runsWhen}
                            />

                            {narrow ? null : <AutomationStatusMark status={status} />}

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
                                        className="truncate text-body-sm text-foreground"
                                        title={name}
                                    >
                                        {name}
                                    </span>
                                </span>
                            ) : (
                                <span className="text-body-sm text-muted-foreground">—</span>
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
            <PageLayout
                workspaceId={workspaceId}
                projectId={projectId}
                title={t("automations.screens.pageTitle")}
                description={t("automations.screens.pageDescription")}
                toolbar={
                    projectEmpty ? undefined : (
                        <ListTableToolbar
                            search={search}
                            onSearchChange={setSearch}
                            searchPlaceholder={t("automations.screens.searchPlaceholder")}
                            actions={
                                <AutomationFilterMenu
                                    view={view}
                                    onChange={setView}
                                    agents={agents}
                                />
                            }
                            end={<ListTableViewToggle value={view.mode} onChange={setMode} />}
                        />
                    )
                }
                actions={
                    <>
                        {/* Hidden on a phone, where the title needs the width. */}
                        {projectEmpty ? null : (
                            <HowThisWorksButton guide="automations" className="max-sm:hidden" />
                        )}
                        <Button onClick={() => void router.push(`${base}/automations/new`)}>
                            <Plus />
                            {t("automations.screens.newAutomation")}
                        </Button>
                    </>
                }
            >
                {projectEmpty ? (
                    <FeatureOnboarding guideKey="automations" base={base}>
                        <AutomationAgentStarters base={base} />
                    </FeatureOnboarding>
                ) : (
                    body
                )}
            </PageLayout>
        </>
    )
}
