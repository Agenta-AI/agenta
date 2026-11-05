import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {useObservability} from "@agenta/observability"
import {ObservabilityRangePicker, ObservabilityToolbar} from "@agenta/observability-ui"
import {AddActionsDropdown, DeleteTraceModal, deleteTraceModalAtom} from "@agenta/observability-ui"
import {PageLayout} from "@agenta/ui"
import {useIsNarrowScreen} from "@agenta/ui/hooks"
import {useQueryClient} from "@tanstack/react-query"
import {useSetAtom} from "jotai"
import {MessagesSquare, Network} from "lucide-react"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {projectHomeUrl} from "@/lib/context"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {useProjectPermissionState} from "../context/useProjectPermission"
import {canDeveloperViewBeEnabled, useDeveloperViewEnabled} from "../developer/developerViewAccess"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {useAddToTestsetAction} from "./addToTestset/useAddToTestsetAction"
import {ObservabilityAppFilter} from "./ObservabilityAppFilter"
import {useObservabilityAppScope, useSelectObservabilityApp} from "./observabilityAppScope"
import {useAddAllMatchingAction} from "./queueAll/useAddAllMatchingAction"
import {selectedTraceIds} from "./selectedTraceIds"
import {useObservabilitySessionUrl} from "./sessionDrawer/useObservabilitySessionUrl"
import {SessionsList} from "./SessionsList"
import {SessionsTable} from "./SessionsTable"
import {TracesFilters} from "./TracesFilters"
import {TracesList} from "./TracesList"
import {TracesTable} from "./TracesTable"
import {useTracesExportBinding} from "./useTracesExportBinding"

// Loaded on the first session opened, so the page everyone opens does not carry the drawer.
const ObservabilitySessionDrawer = dynamic(
    () => import("./sessionDrawer/ObservabilitySessionDrawer"),
    {ssr: false},
)

type ObservabilityTab = "traces" | "sessions"

/**
 * Project-wide observability.
 *
 * This app replaces the desktop one, so the screen is not phone-only: `AppShell` gives it the
 * persistent rail at lg+, the hamburger only appears below lg, and the body runs the full
 * content width the way the desktop table does.
 *
 * Both the toolbar and the range picker are the SAME components the desktop renders, so search,
 * Root/LLM/All, realtime and auto-refresh behave identically here without a line of mobile-only
 * chrome. Export and delete are hidden by omitting their handlers, which is how the toolbar
 * expresses a capability the host does not offer — not a fork.
 */
/** The same two tabs, with the same icons, the desktop header shows. */
const TAB_ITEMS = [
    {
        key: "traces",
        label: (
            <span className="flex items-center gap-2">
                <Network size={16} />
                <span>Traces</span>
            </span>
        ),
    },
    {
        key: "sessions",
        label: (
            <span className="flex items-center gap-2">
                <MessagesSquare size={16} />
                <span>Sessions</span>
            </span>
        ),
    },
]

const ObservabilityContent = ({
    workspaceId,
    projectId,
    appFilterEnabled,
    routeAppId,
}: {
    workspaceId: string
    projectId: string
    appFilterEnabled: boolean
    routeAppId: string | null
}) => {
    useBindProjectContext(projectId)
    const [tab, setTab] = useState<ObservabilityTab>("traces")
    // This whole screen is trace content. A role without `view_spans` reads none of it, so the
    // route itself leads back to the project rather than to a page of refusals.
    const router = useRouter()
    const spans = useProjectPermissionState(projectId, "view_spans")
    useEffect(() => {
        if (!spans.pending && !spans.allowed)
            void router.replace(projectHomeUrl({workspaceId, projectId}))
    }, [spans.allowed, spans.pending, projectId, router, workspaceId])

    const onAppChange = useSelectObservabilityApp()
    const tracesFilters = tab === "traces" ? <TracesFilters /> : undefined

    const session = useObservabilitySessionUrl()
    // Mounted once a session has been opened, and kept so the panel can slide out.
    const [sessionDrawerRequested, setSessionDrawerRequested] = useState(false)
    if (session.sessionId !== null && !sessionDrawerRequested) setSessionDrawerRequested(true)

    const isNarrow = useIsNarrowScreen()
    // Selection lives in the table; the narrow card list has none. Anything that acts on a
    // selection is only meaningful when the table is what is on screen.

    const showsTable = !isNarrow
    const bodyRef = useRef<HTMLDivElement | null>(null)

    // The selection lives in the shared atom: the toolbar's Delete button reads it to enable.
    const {fetchTraces, traces, selectedRowKeys, setSelectedRowKeys, filters, sort, traceTabs} =
        useObservability()
    // Not `useSessions()`: that would load sessions and their spans on the Traces tab too.
    const queryClient = useQueryClient()

    // Swallow the refetch results: the toolbar only needs the promise to settle.
    const {onExport, isExporting} = useTracesExportBinding()
    const openDeleteModal = useSetAtom(deleteTraceModalAtom)
    // Rows are keyed by span id; delete and the queue take trace ids.
    const traceIds = useMemo(
        () => selectedTraceIds(traces, selectedRowKeys),
        [traces, selectedRowKeys],
    )
    const clearSelection = useCallback(() => setSelectedRowKeys([]), [setSelectedRowKeys])
    // The atom outlives the screen; a selection must not come back on the next visit.
    useEffect(() => clearSelection, [clearSelection])
    const addToTestset = useAddToTestsetAction(projectId, selectedRowKeys.map(String))
    const queueAllMatching = useAddAllMatchingAction({
        workspaceId,
        projectId,
        appId: (appFilterEnabled && routeAppId) || "",
        filters,
        sort,
        traceTabs,
        hasTraces: traces.length > 0,
    })

    const onDelete = useCallback(
        () => openDeleteModal({isOpen: true, traceIds, onClose: clearSelection}),
        [openDeleteModal, traceIds, clearSelection],
    )

    const onRefresh = useCallback(async () => {
        if (tab === "traces") await fetchTraces()
        else
            await Promise.all([
                queryClient.invalidateQueries({queryKey: ["sessions"]}),
                queryClient.invalidateQueries({queryKey: ["session_spans"]}),
            ])
    }, [tab, fetchTraces, queryClient])

    return (
        <>
            <PageTitle title="Observability" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    fill
                    header={
                        <div className="flex items-center gap-2 px-4 pt-3 lg:hidden">
                            <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                        </div>
                    }
                >
                    {/* The desktop app shows a table, so at lg+ so does this. Below lg the same
                        rows stack, which is the only presentation that fits a phone. */}
                    <PageLayout
                        title="Observability"
                        className="h-full overflow-hidden"
                        headerTabsProps={{
                            items: TAB_ITEMS,
                            activeKey: tab,
                            onChange: (key) => setTab(key as ObservabilityTab),
                        }}
                    >
                        <ObservabilityToolbar
                            componentType={tab}
                            onRefresh={onRefresh}
                            sortSlot={<ObservabilityRangePicker />}
                            filtersSlot={
                                appFilterEnabled ? (
                                    <>
                                        {tracesFilters}
                                        <ObservabilityAppFilter
                                            projectId={projectId}
                                            value={routeAppId}
                                            onChange={onAppChange}
                                        />
                                    </>
                                ) : (
                                    tracesFilters
                                )
                            }
                            onExport={tab === "traces" ? onExport : undefined}
                            isExporting={isExporting}
                            onDelete={tab === "traces" && showsTable ? onDelete : undefined}
                            actionsSlot={
                                tab === "traces" && showsTable ? (
                                    <AddActionsDropdown
                                        testsetAction={addToTestset.testsetAction}
                                        queueAction={{
                                            itemType: "traces",
                                            itemIds: traceIds,
                                            label:
                                                traceIds.length > 0
                                                    ? `Add ${traceIds.length} selected to queue`
                                                    : "Add selected to queue",
                                            disabled: traceIds.length === 0,
                                            onItemsAdded: clearSelection,
                                        }}
                                        queueAllMatchingAction={queueAllMatching}
                                    />
                                ) : undefined
                            }
                        />
                        <div
                            ref={bodyRef}
                            className="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
                        >
                            {/* Cards on a phone, the real table on anything wider. The tables size
                            themselves from this flex parent, so there is no height to thread
                            through — gating on a measured one just showed cards until it
                            resolved, chrome and all. */}
                            {tab === "sessions" ? (
                                !showsTable ? (
                                    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
                                        <SessionsList onOpenSession={session.open} />
                                    </div>
                                ) : (
                                    <SessionsTable onOpenSession={session.open} />
                                )
                            ) : !showsTable ? (
                                <div className="min-h-0 flex-1 overflow-y-auto pb-6">
                                    <TracesList />
                                </div>
                            ) : (
                                <TracesTable
                                    selectedRowKeys={selectedRowKeys}
                                    onSelectionChange={setSelectedRowKeys}
                                />
                            )}
                        </div>
                        <DeleteTraceModal />
                        {sessionDrawerRequested ? (
                            <ObservabilitySessionDrawer
                                sessionId={session.sessionId}
                                onSelectSession={session.open}
                            />
                        ) : null}
                        {addToTestset.sheet}
                    </PageLayout>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}

/**
 * Project wide, which is the scope seam's own default, unless the app filter developer view is
 * on: then `?app=` scopes the queries and the toolbar gets a picker.
 *
 * The content subscribes to the traces query as soon as it renders, so a link with `?app=` waits
 * here for the answer on the view. Without that wait its first request would be project wide.
 */
export const ObservabilityScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    const router = useRouter()
    const appFilterView = useDeveloperViewEnabled("observability-app-filter")
    const appFilterEnabled = appFilterView === true
    const routeAppId = typeof router.query.app === "string" ? router.query.app : null
    useObservabilityAppScope(appFilterEnabled ? routeAppId : null)

    if (
        appFilterView === null &&
        routeAppId !== null &&
        canDeveloperViewBeEnabled("observability-app-filter")
    )
        return null
    return (
        <ObservabilityContent
            workspaceId={workspaceId}
            projectId={projectId}
            appFilterEnabled={appFilterEnabled}
            routeAppId={routeAppId}
        />
    )
}

export default ObservabilityScreen
