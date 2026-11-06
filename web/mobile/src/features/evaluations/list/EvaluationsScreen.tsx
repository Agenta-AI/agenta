import {useCallback} from "react"

import {useDebouncedAtomSearch} from "@agenta/shared/hooks"
import {message} from "@agenta/ui/app-message"
import {LoadError} from "@agenta/ui/components/presentational"
import {ListTableToolbar} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {Spinner} from "@phosphor-icons/react"
import dynamic from "next/dynamic"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {useBindWorkspaceMembers} from "@/features/members/useBindWorkspaceMembers"

import {AppOverviewLink} from "../../app-overview/AppOverviewLink"
import {useBindProjectContext} from "../../context/useBindProjectContext"
import {useDeveloperPageFrame} from "../../developer/developerPageFrame"
import {AppShell} from "../../nav/AppShell"
import {NavDrawer} from "../../nav/NavDrawer"
import {ObservabilityAppFilter} from "../../observability/ObservabilityAppFilter"
import {useRevisionParam} from "../../revisions/useRevisionParam"

import {CreateEvaluationMenu, type CreatableKind} from "./CreateEvaluationMenu"
import {EvaluationKindTabs} from "./EvaluationKindTabs"
import {EvaluationRunsTable} from "./EvaluationRunsTable"
import {RunStatusFilter} from "./RunStatusFilter"
import {EvaluationsEmpty} from "./states/EvaluationsEmpty"
import {EvaluationsKeepLooking} from "./states/EvaluationsKeepLooking"
import {EvaluationsNoMatch} from "./states/EvaluationsNoMatch"
import {useEvaluationRunsFilters} from "./useEvaluationRunsFilters"
import {useEvaluationRunsList} from "./useEvaluationRunsList"
import {useRunRowActions} from "./useRunRowActions"

// The drawer and its config pane cost nothing until a reader opens a variant.
const RevisionDrawerHost = dynamic(
    () => import("../../revisions/RevisionDrawerHost").then((module) => module.RevisionDrawerHost),
    {ssr: false},
)

/**
 * The evaluation runs of a project, or of one app with `?app=`. Filters live in the URL.
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
    const {kind, appId, search, statuses} = filters
    const list = useEvaluationRunsList({projectId, kind, appId, search, statuses})
    const actions = useRunRowActions({projectId, base: `/w/${workspaceId}/p/${projectId}`})
    const [revisionId] = useRevisionParam()
    const searchField = useDebouncedAtomSearch(filters.setSearch, 300, search)
    const filtered = search.trim() !== "" || statuses.length > 0
    const canCreate = Boolean(onCreate) && actions.canEdit

    const loadMore = useCallback(async () => {
        const result = await list.fetchNextPage()
        if (result.isError) message.error("Couldn't load more evaluations")
    }, [list])

    const createMenu =
        canCreate && onCreate ? (
            <CreateEvaluationMenu
                tab={kind}
                onCreate={onCreate}
                kinds={createKinds}
                label={kind === "all" ? "Start evaluation" : "New evaluation"}
            />
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
                                <AppOverviewLink
                                    base={`/w/${workspaceId}/p/${projectId}`}
                                    appId={appId}
                                />
                                <ObservabilityAppFilter
                                    projectId={projectId}
                                    value={appId}
                                    onChange={filters.setAppId}
                                />
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
                                    <RunStatusFilter
                                        value={statuses}
                                        onChange={filters.setStatuses}
                                    />
                                    {createMenu}
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
                                <EvaluationRunsTable
                                    runs={list.runs}
                                    isLoading={list.isPending}
                                    scope={appId ? "app" : "project"}
                                    actions={actions}
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
