import type {Key} from "react"
import {useCallback, useRef, useState} from "react"

import {useObservability, useSessions} from "@agenta/observability"
import {ObservabilityRangePicker, ObservabilityToolbar} from "@agenta/observability-ui"
import {AddActionsDropdown, DeleteTraceModal, deleteTraceModalAtom} from "@agenta/observability-ui"
import {TraceDrawer} from "@agenta/observability-ui/traceDrawer"
import {PageLayout} from "@agenta/ui"
import {useIsNarrowScreen} from "@agenta/ui/hooks"
import {useSetAtom} from "jotai"
import {MessagesSquare, Network} from "lucide-react"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {bindTraceDrawerSeams} from "./bindTraceDrawerSeams"
import {SessionsList} from "./SessionsList"
import {SessionsTable} from "./SessionsTable"
import {TracesFilters} from "./TracesFilters"
import {TracesList} from "./TracesList"
import {TracesTable} from "./TracesTable"
import {useTracesExportBinding} from "./useTracesExportBinding"

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

export const ObservabilityScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindProjectContext(projectId)
    const [tab, setTab] = useState<ObservabilityTab>("traces")

    // No scope binding: the seam's own defaults are project-wide with no workflow, which is
    // exactly this screen. Binding would only re-state them.

    const isNarrow = useIsNarrowScreen()
    // Selection lives in the table; the narrow card list has none. Anything that acts on a
    // selection is only meaningful when the table is what is on screen.
    const router = useRouter()
    // The drawer keeps its trace in the URL and links out; both need this host's router.
    bindTraceDrawerSeams(router)

    const showsTable = !isNarrow
    const bodyRef = useRef<HTMLDivElement | null>(null)

    const {fetchTraces} = useObservability()
    const {refetchSessions} = useSessions()

    // Swallow the refetch results: the toolbar only needs the promise to settle.
    const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([])
    const {onExport, isExporting} = useTracesExportBinding()
    const openDeleteModal = useSetAtom(deleteTraceModalAtom)

    const onDelete = useCallback(
        () => openDeleteModal({isOpen: true, traceIds: selectedRowKeys.map(String)}),
        [openDeleteModal, selectedRowKeys],
    )

    const onRefresh = useCallback(async () => {
        if (tab === "traces") await fetchTraces()
        else await refetchSessions()
    }, [tab, fetchTraces, refetchSessions])

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
                            filtersSlot={tab === "traces" ? <TracesFilters /> : undefined}
                            onExport={tab === "traces" ? onExport : undefined}
                            isExporting={isExporting}
                            onDelete={tab === "traces" && showsTable ? onDelete : undefined}
                            actionsSlot={
                                tab === "traces" && showsTable ? (
                                    <AddActionsDropdown
                                        queueAction={{
                                            itemType: "traces",
                                            itemIds: selectedRowKeys.map(String),
                                            label:
                                                selectedRowKeys.length > 0
                                                    ? `Add ${selectedRowKeys.length} selected to queue`
                                                    : "Add selected to queue",
                                            disabled: selectedRowKeys.length === 0,
                                        }}
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
                                        <SessionsList />
                                    </div>
                                ) : (
                                    <SessionsTable />
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
                        {/* Same drawer web/oss renders — a tapped trace opens here too now. */}
                        <TraceDrawer />
                    </PageLayout>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}

export default ObservabilityScreen
