import {useCallback, useEffect, useRef, useState} from "react"

import {useObservability, useSessions} from "@agenta/observability"
import {ObservabilityRangePicker, ObservabilityToolbar} from "@agenta/observability-ui"
import {useIsNarrowScreen} from "@agenta/ui/hooks"
import {Tabs, TabsList, TabsTrigger} from "@agenta/ui/ui"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {SessionsList} from "./SessionsList"
import {TracesList} from "./TracesList"
import {TracesTable} from "./TracesTable"

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
    const bodyRef = useRef<HTMLDivElement | null>(null)
    const [bodyHeight, setBodyHeight] = useState(0)

    // The windowed table needs a real viewport height, not a flex-derived one.
    useEffect(() => {
        const node = bodyRef.current
        if (!node || typeof ResizeObserver === "undefined") return
        const observer = new ResizeObserver(([entry]) => setBodyHeight(entry.contentRect.height))
        observer.observe(node)
        return () => observer.disconnect()
    }, [])

    const {fetchTraces} = useObservability()
    const {refetchSessions} = useSessions()

    // Swallow the refetch results: the toolbar only needs the promise to settle.
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
                        <div className="flex flex-col gap-3 px-4 py-3 lg:px-6">
                            <div className="flex items-center gap-2">
                                <span className="lg:hidden">
                                    <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                </span>
                                <h1 className="m-0 text-base font-medium text-foreground">
                                    Observability
                                </h1>
                            </div>

                            <Tabs
                                value={tab}
                                onValueChange={(next) => setTab(next as ObservabilityTab)}
                            >
                                <TabsList>
                                    <TabsTrigger value="traces">Traces</TabsTrigger>
                                    <TabsTrigger value="sessions">Sessions</TabsTrigger>
                                </TabsList>
                            </Tabs>

                            <ObservabilityToolbar
                                componentType={tab}
                                onRefresh={onRefresh}
                                sortSlot={<ObservabilityRangePicker />}
                            />
                        </div>
                    }
                >
                    {/* The desktop app shows a table, so at lg+ so does this. Below lg the same
                        rows stack, which is the only presentation that fits a phone. */}
                    <div
                        ref={bodyRef}
                        className="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
                    >
                        {tab === "sessions" ? (
                            <div className="min-h-0 flex-1 overflow-y-auto pb-6">
                                <SessionsList />
                            </div>
                        ) : isNarrow || !bodyHeight ? (
                            <div className="min-h-0 flex-1 overflow-y-auto pb-6">
                                <TracesList />
                            </div>
                        ) : (
                            <TracesTable height={bodyHeight} />
                        )}
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}

export default ObservabilityScreen
