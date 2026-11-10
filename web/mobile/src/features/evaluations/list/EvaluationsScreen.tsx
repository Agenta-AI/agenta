import {useCallback, useMemo, useState} from "react"

import {useDebouncedAtomSearch} from "@agenta/shared/hooks"
import {message} from "@agenta/ui/app-message"
import {LoadError} from "@agenta/ui/components/presentational"
import {ListTableColumnsMenu, ListTableToolbar} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {Spinner} from "@phosphor-icons/react"
import dynamic from "next/dynamic"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {useBindWorkspaceMembers} from "@/features/members/useBindWorkspaceMembers"

import {AppOverviewLink} from "../../app-overview/AppOverviewLink"
import {useBindProjectContext} from "../../context/useBindProjectContext"
import {useProjectPermission} from "../../context/useProjectPermission"
import {useDeveloperPageFrame} from "../../developer/developerPageFrame"
import {AppShell} from "../../nav/AppShell"
import {NavDrawer} from "../../nav/NavDrawer"
import {ObservabilityAppFilter} from "../../observability/ObservabilityAppFilter"
import {useRevisionParam} from "../../revisions/useRevisionParam"

import {CreateEvaluationMenu, type CreatableKind} from "./CreateEvaluationMenu"
import {EvaluationKindTabs} from "./EvaluationKindTabs"
import {RunsTable} from "./EvaluationRunsTable"
import {RunFilterChips} from "./RunFilterChips"
import {RunFiltersPanel} from "./RunFiltersPanel"
import {runDisplayName} from "./runReferences"
import {RunsExportButton} from "./RunsExportButton"
import {EvaluationsEmpty} from "./states/EvaluationsEmpty"
import {EvaluationsKeepLooking} from "./states/EvaluationsKeepLooking"
import {EvaluationsNoMatch} from "./states/EvaluationsNoMatch"
import {
    countRunFilters,
    REFERENCE_FILTERS,
    useEvaluationRunsFilters,
} from "./useEvaluationRunsFilters"
import {useEvaluationRunsList} from "./useEvaluationRunsList"
import {useRunFilterOptions} from "./useRunFilterOptions"
import {useRunRowActions} from "./useRunRowActions"
import {useRunsTableLayout} from "./useRunsTableLayout"

// The drawer and its config pane cost nothing until a reader opens a variant.
const RevisionDrawerHost = dynamic(
    () => import("../../revisions/RevisionDrawerHost").then((module) => module.RevisionDrawerHost),
    {ssr: false},
)

/**
 * The evaluation runs of a project, or of one app (from the path or `?app=`). Filters live in the URL.
 *
 * `onCreate` starts a new evaluation of a kind. Without it the page offers no create button.
 * `createKinds` limits the kinds the create entry offers.
 */
export const EvaluationsScreen = ({
    workspaceId,
    projectId,
    onCreate,
    createKinds,
}: {
    workspaceId: string
    projectId: string
    onCreate?: (kind: CreatableKind) => void
    /** The kinds the create entry offers. Absent: all of them. */
    createKinds?: readonly CreatableKind[]
}) => {
    const PAGE_FRAME = useDeveloperPageFrame()
    useBindWorkspaceMembers()
    useBindProjectContext(projectId)
    const filters = useEvaluationRunsFilters()
    const {kind, appId, search, panel} = filters
    const list = useEvaluationRunsList({projectId, kind, appId, search, panel})
    const [panelOpen, setPanelOpen] = useState(false)
    // The choices load when the panel opens, or when a chip needs the names of its ids.
    const filterOptions = useRunFilterOptions({
        projectId,
        appId,
        enabled: panelOpen || REFERENCE_FILTERS.some((key) => panel.references[key].length > 0),
    })
    const actions = useRunRowActions({projectId, base: `/w/${workspaceId}/p/${projectId}`})
    const [revisionId] = useRevisionParam()
    const searchField = useDebouncedAtomSearch(filters.setSearch, 300, search)
    const filtered = search.trim() !== "" || countRunFilters(panel) > 0
    const canCreate = Boolean(onCreate) && actions.canEdit
    const layout = useRunsTableLayout({
        runs: list.runs,
        kind,
        scope: appId ? "app" : "project",
        columnsKey: "evaluations",
    })
    // Export needs the API key permissions, as in the old list.
    const canViewKeys = useProjectPermission(projectId, "view_api_keys")
    const canEditKeys = useProjectPermission(projectId, "edit_api_keys")
    const canExport = canViewKeys && canEditKeys
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
    // Only the runs on screen count: a run that left the list (another tab, a filter, a delete)
    // is neither deleted nor exported.
    const selectedRuns = useMemo(
        () => list.runs.filter((run) => selected.has(run.id)),
        [list.runs, selected],
    )
    const selectedKeys = useMemo(() => new Set(selectedRuns.map((run) => run.id)), [selectedRuns])
    const bulkBusy = selectedRuns.some((run) => actions.isBusy(run.id))

    const loadMore = useCallback(async () => {
        const result = await list.fetchNextPage()
        if (result.isError) message.error("Couldn't load more evaluations")
    }, [list])

    const createMenu =
        canCreate && onCreate ? (
            <CreateEvaluationMenu tab={kind} onCreate={onCreate} kinds={createKinds} />
        ) : null

    return (
        <>
            <PageTitle title="Evaluations" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div
                            className={`box-border shrink-0 px-4 pb-3 pt-3 lg:pt-14 ${PAGE_FRAME}`}
                        >
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px]">
                                    Evaluations
                                </h1>
                                {filters.appFromPath ? null : (
                                    <>
                                        <AppOverviewLink
                                            base={`/w/${workspaceId}/p/${projectId}`}
                                            appId={appId}
                                        />
                                        <ObservabilityAppFilter
                                            projectId={projectId}
                                            value={appId}
                                            onChange={filters.setAppId}
                                        />
                                    </>
                                )}
                            </div>
                        </div>
                    }
                >
                    <div className={`min-w-0 px-4 pb-12 pt-3 ${PAGE_FRAME}`}>
                        <div className="mb-3">
                            <EvaluationKindTabs
                                value={kind}
                                appScoped={appId !== null}
                                onChange={filters.setKind}
                            />
                        </div>
                        <ListTableToolbar
                            search={searchField.value}
                            onSearchChange={searchField.onChange}
                            searchPlaceholder="Search evaluations"
                            actions={
                                <>
                                    <RunFiltersPanel
                                        value={panel}
                                        onApply={filters.setPanel}
                                        options={filterOptions}
                                        onOpenChange={setPanelOpen}
                                        showType={kind === "all"}
                                        appPicked={appId !== null}
                                    />
                                    {/* A phone keeps the count on the button; the chips need room. */}
                                    <div className="hidden min-w-0 flex-1 sm:block">
                                        <RunFilterChips
                                            value={panel}
                                            options={filterOptions}
                                            onChange={filters.setPanel}
                                        />
                                    </div>
                                    <div className="ml-auto flex items-center gap-2">
                                        <ListTableColumnsMenu
                                            columns={layout.allColumns}
                                            hiddenKeys={layout.hiddenKeys}
                                            onChange={layout.setColumnVisible}
                                        />
                                        {canExport ? (
                                            <RunsExportButton
                                                projectId={projectId}
                                                runs={
                                                    selectedRuns.length > 0
                                                        ? selectedRuns
                                                        : list.runs
                                                }
                                                plan={layout.plan}
                                                evaluatorNames={layout.evaluatorNames}
                                            />
                                        ) : null}
                                        {createMenu}
                                    </div>
                                </>
                            }
                        />
                        {list.isError ? (
                            // A failed fetch must not read as an empty project.
                            <LoadError
                                framed
                                title="Could not load evaluations"
                                onRetry={() => void list.refetch()}
                            />
                        ) : (
                            <>
                                <RunsTable
                                    runs={list.runs}
                                    layout={layout}
                                    isLoading={list.isPending}
                                    actions={actions}
                                    selection={
                                        // No checkboxes over an empty list: its header row stays hidden.
                                        list.runs.length > 0 && (actions.canEdit || canExport)
                                            ? {
                                                  selectedKeys,
                                                  onChange: setSelected,
                                                  rowLabel: (run) =>
                                                      `Select ${runDisplayName(run)}`,
                                                  bulkActions: () =>
                                                      actions.canEdit ? (
                                                          <Button
                                                              type="button"
                                                              size="sm"
                                                              variant="destructive"
                                                              disabled={bulkBusy}
                                                              onClick={() =>
                                                                  actions.removeRuns(
                                                                      selectedRuns,
                                                                      () => setSelected(new Set()),
                                                                  )
                                                              }
                                                          >
                                                              Delete
                                                          </Button>
                                                      ) : null,
                                              }
                                            : undefined
                                    }
                                    empty={
                                        list.hasNextPage ? (
                                            <EvaluationsKeepLooking />
                                        ) : filtered ? (
                                            <EvaluationsNoMatch onClear={filters.clearFilters} />
                                        ) : (
                                            <EvaluationsEmpty
                                                kind={kind}
                                                onCreate={canCreate ? onCreate : undefined}
                                                createKinds={createKinds}
                                                createMenu={
                                                    canCreate && onCreate ? (
                                                        <CreateEvaluationMenu
                                                            tab="all"
                                                            onCreate={onCreate}
                                                            kinds={createKinds}
                                                            label="Start evaluation"
                                                        />
                                                    ) : null
                                                }
                                            />
                                        )
                                    }
                                />
                                {list.hasNextPage ? (
                                    <div className="mt-4 flex justify-center">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={list.isFetchingNextPage}
                                            onClick={() => void loadMore()}
                                        >
                                            {list.isFetchingNextPage ? (
                                                <Spinner aria-hidden className="animate-spin" />
                                            ) : null}
                                            Load more
                                        </Button>
                                    </div>
                                ) : null}
                            </>
                        )}
                    </div>
                </ScreenScaffold>
            </AppShell>
            {actions.modal}
            {revisionId ? <RevisionDrawerHost kind="variant" /> : null}
        </>
    )
}
