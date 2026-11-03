import {useEffect, useMemo, useRef} from "react"

import type {Filter, SortResult} from "@agenta/observability"
import type {AddActionsDropdownProps} from "@agenta/observability-ui"
import {useRouter} from "next/router"

import {useDeveloperViewEnabled} from "@/features/developer/developerViewAccess"

import {useTraceActionAccess} from "../useTraceActionAccess"

interface Args {
    workspaceId: string
    projectId: string
    /** The app the page is scoped to, or "" for the whole project. */
    appId: string
    filters: Filter[]
    sort: SortResult | undefined
    traceTabs: string
    hasTraces: boolean
}

/**
 * The "Add all matching filter to queue" item of the traces toolbar Add menu, or `undefined` when
 * the user does not see it. The confirm and the scan load with `import()` when they are needed, so
 * the page carries only this hook. Leaving the page stops a scan in progress.
 */
export const useAddAllMatchingAction = ({
    workspaceId,
    projectId,
    appId,
    filters,
    sort,
    traceTabs,
    hasTraces,
}: Args): AddActionsDropdownProps["queueAllMatchingAction"] => {
    const allowed = useTraceActionAccess(projectId, "edit_evaluation_queues")
    const queuesView = useDeveloperViewEnabled("annotation-queues") === true
    const router = useRouter()

    // Aborted when the page goes away, which stops a run in progress.
    const page = useRef<AbortController | null>(null)
    useEffect(() => {
        const controller = new AbortController()
        page.current = controller
        return () => controller.abort()
    }, [])

    return useMemo(() => {
        if (!allowed) return undefined
        // The default trace type row narrows nothing; the app scope does.
        const narrowed = Boolean(appId) || filters.some((filter) => filter.field !== "trace_type")
        const onViewQueue = queuesView
            ? (queueId: string) =>
                  void router.push(`/w/${workspaceId}/p/${projectId}/annotations/${queueId}`)
            : undefined
        return {
            label: "Add all matching filter to queue",
            disabled: !hasTraces,
            onBeforeOpen: () =>
                narrowed ||
                import("./runAddAllMatching").then(({confirmEveryTrace}) => confirmEveryTrace()),
            onQueueSelected: (queue) => {
                const pageSignal = page.current?.signal
                if (!pageSignal) return
                void import("./runAddAllMatching").then(({runAddAllMatching}) =>
                    runAddAllMatching({
                        queue,
                        projectId,
                        appId,
                        filters,
                        sort,
                        traceTabs,
                        pageSignal,
                        onViewQueue,
                    }),
                )
            },
        }
    }, [
        allowed,
        appId,
        filters,
        hasTraces,
        projectId,
        queuesView,
        router,
        sort,
        traceTabs,
        workspaceId,
    ])
}
