import {useEffect, useMemo, useRef} from "react"

import {buildTraceQueryParams, type Filter, type SortResult} from "@agenta/observability"
import type {AddActionsDropdownProps} from "@agenta/observability-ui"
import {useRouter} from "next/router"

import {useDeveloperViewEnabled} from "@/features/developer/developerViewAccess"

import {useTraceActionAccess} from "../useTraceActionAccess"

import {confirmEveryTrace} from "./confirmEveryTrace"
import type {QueueRun} from "./runAddAllMatching"

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
 * the user does not see it. Picking a queue loads the scan with `import()`, so the page carries
 * only this hook. One scan runs at a time; a new one or leaving the page stops it.
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

    const current = useRef<AbortController | null>(null)
    useEffect(() => () => current.current?.abort(), [])
    const run = useMemo<QueueRun>(
        () => ({
            begin: () => {
                current.current?.abort()
                current.current = new AbortController()
                return current.current
            },
            owns: (controller) => current.current === controller,
        }),
        [],
    )

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
            onBeforeOpen: () => narrowed || confirmEveryTrace(),
            onQueueSelected: (queue) => {
                const query = buildTraceQueryParams(filters, sort, traceTabs)
                void import("./runAddAllMatching").then(({runAddAllMatching}) =>
                    runAddAllMatching({queue, projectId, appId, query, run, onViewQueue}),
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
        run,
        sort,
        traceTabs,
        workspaceId,
    ])
}
