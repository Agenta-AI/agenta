import {addSimpleQueueTraces, type SimpleQueue} from "@agenta/entities/simpleQueue"
import {addAllMatchingTracesToQueue, BatchFlushError} from "@agenta/entities/simpleQueue/etl"
import {inferQueueMaxFromPlan} from "@agenta/entities/trace/etl"
import {
    buildTraceQueryParams,
    createAdaptiveTracePageFetcher,
    withRateLimitRetry,
    type Filter,
    type SortResult,
} from "@agenta/observability"
import {axios, getAgentaApiUrl, getHostQueryClient, isBillingEnabled} from "@agenta/shared/api"
import {message, modal} from "@agenta/ui/app-message"
import type {NoticeType} from "@agenta/ui/app-message"

export interface AddAllMatchingInput {
    queue: Pick<SimpleQueue, "id" | "name">
    projectId: string
    /** The app the page is scoped to, or "" for the whole project. */
    appId: string
    /** The traces page query: its filters, time range and Root/LLM/All tab. */
    filters: Filter[]
    sort: SortResult | undefined
    traceTabs: string
    /** Aborts when the traces page goes away; the run stops with it. */
    pageSignal: AbortSignal
    /** Opens the queue. Without it the success toast has no "View queue" button. */
    onViewQueue?: (queueId: string) => void
}

/** Asks before a scan with no filter; resolves `true` when the user agrees to queue every trace. */
export const confirmEveryTrace = () =>
    new Promise<boolean>((resolve) => {
        modal.confirm({
            title: "Add every trace to the queue?",
            content: "No filter is active. This will queue every trace in the project. Continue?",
            okText: "Continue",
            cancelText: "Cancel",
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
        })
    })

/** The run in progress. A new run stops it. */
let current: AbortController | null = null
const TOAST_KEY = "queue-all-matching"

/** The per-run cap of the organization's plan. Without billing, or when it fails, the lowest. */
const readQueueCap = async (projectId: string): Promise<number> => {
    if (!isBillingEnabled()) return inferQueueMaxFromPlan(null)
    // The request `fetchCurrentSubscription` sends. The `@agenta/settings-ui` barrel is not
    // imported: what this chunk takes from a barrel the app shell loads ends up in the shell.
    const subscription = await axios
        .get<{plan?: string | null} | null>(`${getAgentaApiUrl()}/billing/subscription`, {
            params: {project_id: projectId},
        })
        .then((response) => response.data)
        .catch(() => null)
    return inferQueueMaxFromPlan(subscription?.plan)
}

const count = (value: number) => value.toLocaleString()

/**
 * Marks the queue's cached data stale, so its pages show the new items. The keys are the ones the
 * queue molecule reads; the molecule itself is not imported, because this chunk sharing it moves
 * modules of the app shell between chunks and the shell grows.
 */
const refreshQueueCaches = (queueId: string) => {
    const client = getHostQueryClient()
    void client.invalidateQueries({queryKey: ["simpleQueue", queueId], exact: true})
    void client.invalidateQueries({queryKey: ["simpleQueue", "scenarioProgress", queueId]})
    void client.invalidateQueries({queryKey: ["simpleQueues", "list"]})
}

const QueueToast = ({title, description}: {title: string; description: string}) => (
    <span className="flex flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span>{description}</span>
    </span>
)

interface Toast {
    type: NoticeType
    title: string
    description: string
    /** Seconds on screen; 0 stays until closed. */
    duration: number
    action?: {label: string; onClick: () => void}
}

/**
 * One scan. `added` holds the trace ids this run, and the runs it retries, added to the queue: the
 * scan skips them, and the counts it shows include them.
 */
const scan = async (
    input: AddAllMatchingInput,
    controller: AbortController,
    added: Set<string>,
) => {
    const {queue, projectId, appId, pageSignal, onViewQueue} = input
    // A newer run, or leaving the page, takes the toast away from this run.
    const owned = () => current === controller && !pageSignal.aborted
    const query = buildTraceQueryParams(input.filters, input.sort, input.traceTabs)
    const addedBefore = added.size
    const queueName = queue.name || "queue"
    const maxItems = await readQueueCap(projectId)
    const max = count(maxItems)
    if (!owned()) return

    // One toast, updated in place; a new run takes it over.
    const show = ({type, title, description, duration, action}: Toast) =>
        message.open({
            key: TOAST_KEY,
            type,
            duration,
            action,
            content: <QueueToast title={title} description={description} />,
        })
    const cancel = {label: "Cancel", onClick: () => controller.abort()}
    const showRunning = () =>
        show({
            type: "loading",
            title: `Queuing traces to "${queueName}"`,
            description: `Queued ${count(added.size)} of up to ${max} traces…`,
            duration: 0,
            action: cancel,
        })
    const showRateLimited = (delayMs: number) => {
        if (!owned()) return
        show({
            type: "loading",
            title: "Rate limited, pausing",
            description:
                `Queued ${count(added.size)} of up to ${max} traces. The server is throttling ` +
                `requests; retrying in ${Math.ceil(delayMs / 1000)}s…`,
            duration: 0,
            action: cancel,
        })
    }
    showRunning()

    try {
        const result = await addAllMatchingTracesToQueue({
            fetchPage: createAdaptiveTracePageFetcher({
                params: query.params,
                appId,
                projectId,
                isHasAnnotationSelected: query.isHasAnnotationSelected,
                hasAnnotationConditions: query.hasAnnotationConditions,
                hasAnnotationOperator: query.hasAnnotationOperator,
                signal: controller.signal,
                onRateLimitPause: showRateLimited,
            }),
            // The queue add has its own rate limit; a 429 there pauses the scan the same way.
            addTraces: (queueId, traceIds) =>
                withRateLimitRetry(
                    async () => {
                        // The batch sink sends the next batch without asking; stop it here.
                        controller.signal.throwIfAborted()
                        const response = await addSimpleQueueTraces(projectId, queueId, traceIds)
                        if (response.queue_id) for (const id of traceIds) added.add(id)
                        return response.queue_id ?? null
                    },
                    {
                        signal: controller.signal,
                        onRetry: showRateLimited,
                    },
                ),
            queueId: queue.id,
            signal: controller.signal,
            // The page fetcher paces itself from the rate limit headers.
            pageDelayMs: 0,
            excludeTraceIds: added,
            // The cap counts the traces the retried runs added.
            maxItems: Math.max(maxItems - added.size, 0),
            onProgress: () => {
                if (!controller.signal.aborted) showRunning()
            },
        })
        if (result.queued > 0) refreshQueueCaches(queue.id)
        // A newer run owns the toast now.
        if (!owned()) return

        if (result.stoppedBy === "cancelled") {
            show({
                type: "warning",
                title: "Cancelled",
                description: `${count(added.size)} traces queued to "${queueName}" before you stopped.`,
                duration: 6,
            })
            return
        }
        if (added.size === 0) {
            show({
                type: "info",
                title: "Nothing queued",
                description: "No traces match this filter, so nothing was queued.",
                duration: 6,
            })
            return
        }
        show({
            type: "success",
            title: `Queued ${count(added.size)} traces`,
            description:
                result.stoppedBy === "cap"
                    ? `Queued to "${queueName}". Hit the ${max}-trace limit for one run. ` +
                      `Narrow the filter to queue the rest. They'll appear as the queue processes.`
                    : `Queued to "${queueName}". They'll appear as the queue processes.`,
            duration: 6,
            action: onViewQueue
                ? {
                      label: "View queue",
                      onClick: () => onViewQueue(queue.id),
                  }
                : undefined,
        })
    } catch (error) {
        if (added.size > addedBefore) refreshQueueCaches(queue.id)
        if (!owned()) return
        const retry = {label: "Retry", onClick: () => void start(input, added)}
        if (error instanceof BatchFlushError) {
            show({
                type: "error",
                title: "Queue add incomplete",
                description: `Queued ${count(added.size)} traces; ${count(error.failedCount)} failed to queue.`,
                duration: 0,
                action: retry,
            })
            return
        }
        console.error("Adding all matching traces to a queue failed", error)
        const partial = added.size > 0
        show({
            type: "error",
            title: partial ? "Queue add incomplete" : "Queue add failed",
            description: partial
                ? `Queued ${count(added.size)} traces before the scan stopped. Try again to queue the rest.`
                : "Something went wrong. Try again.",
            duration: 0,
            action: retry,
        })
    }
}

const start = async (input: AddAllMatchingInput, added: Set<string>): Promise<void> => {
    current?.abort()
    const controller = new AbortController()
    current = controller
    const stop = () => controller.abort()
    if (input.pageSignal.aborted) stop()
    input.pageSignal.addEventListener("abort", stop, {once: true})
    // Leaving the page also clears the toast, so no Retry or stale progress is left on the next page.
    input.pageSignal.addEventListener("abort", () => message.destroy(TOAST_KEY), {once: true})
    try {
        await scan(input, controller, added)
    } finally {
        input.pageSignal.removeEventListener("abort", stop)
    }
}

/**
 * Scans every trace that matches the traces page query and adds the trace ids to `queue`, with a
 * toast that shows the progress and how the run ended. Retry scans again and sends only the
 * traces that were not added.
 */
export const runAddAllMatching = (input: AddAllMatchingInput): Promise<void> =>
    start(input, new Set())
