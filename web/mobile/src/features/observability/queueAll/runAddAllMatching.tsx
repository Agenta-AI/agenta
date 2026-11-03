import {simpleQueueMolecule, type SimpleQueue} from "@agenta/entities/simpleQueue"
import {addAllMatchingTracesToQueue, BatchFlushError} from "@agenta/entities/simpleQueue/etl"
import {inferQueueMaxFromPlan} from "@agenta/entities/trace/etl"
import {
    buildTraceQueryParams,
    createAdaptiveTracePageFetcher,
    withRateLimitRetry,
} from "@agenta/observability"
import {fetchCurrentSubscription} from "@agenta/settings-ui"
import {getHostQueryClient, isBillingEnabled} from "@agenta/shared/api"
import {notification} from "@agenta/ui/app-message"
import {Button} from "@agenta/ui/ui"

/**
 * The one run the traces page owns. `begin` stops the previous run and returns the new one's
 * controller; `owns` tells a run whether it is still the current one.
 */
export interface QueueRun {
    begin: () => AbortController
    owns: (controller: AbortController) => boolean
}

export interface AddAllMatchingInput {
    queue: Pick<SimpleQueue, "id" | "name">
    projectId: string
    /** The app the page is scoped to, or "" for the whole project. */
    appId: string
    query: ReturnType<typeof buildTraceQueryParams>
    run: QueueRun
    /** Opens the queue. Without it the success toast has no "View queue" button. */
    onViewQueue?: (queueId: string) => void
}

/** The per-run cap of the organization's plan. Without billing, or when it fails, the lowest. */
const readQueueCap = async (projectId: string): Promise<number> => {
    if (!isBillingEnabled()) return inferQueueMaxFromPlan(null)
    const subscription = await getHostQueryClient()
        .fetchQuery({
            // The key `useBillingSubscription` uses, so a loaded subscription is not asked again.
            queryKey: ["billing", "subscription", projectId],
            queryFn: () => fetchCurrentSubscription(projectId),
            staleTime: 1000 * 60 * 5,
        })
        .catch(() => null)
    return inferQueueMaxFromPlan(subscription?.plan)
}

const count = (value: number) => value.toLocaleString()

/**
 * Scans every trace that matches the traces page query and adds the trace ids to `queue`, with a
 * notification that shows the progress and how the run ended. Retry starts the whole scan again,
 * so it sends the traces that were already queued once more.
 */
export const runAddAllMatching = async (input: AddAllMatchingInput): Promise<void> => {
    const {queue, projectId, appId, query, run, onViewQueue} = input
    const controller = run.begin()
    const key = `batch-add-queue-${queue.id}`
    const queueName = queue.name || "queue"
    const maxItems = await readQueueCap(projectId)
    const max = count(maxItems)
    if (!run.owns(controller)) return

    const cancelButton = (
        <Button size="sm" variant="outline" onClick={() => controller.abort()}>
            Cancel
        </Button>
    )
    let queued = 0
    const showRunning = () =>
        notification.open({
            key,
            message: `Queuing traces to "${queueName}"`,
            description: `Queued ${count(queued)} of up to ${max} traces…`,
            duration: 0,
            btn: cancelButton,
        })
    const showRateLimited = (delayMs: number) => {
        if (!run.owns(controller)) return
        notification.open({
            key,
            message: "Rate limited, pausing",
            description:
                `Queued ${count(queued)} of up to ${max} traces. The server is throttling ` +
                `requests; retrying in ${Math.ceil(delayMs / 1000)}s…`,
            duration: 0,
            btn: cancelButton,
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
                withRateLimitRetry(() => simpleQueueMolecule.set.addTraces(queueId, traceIds), {
                    signal: controller.signal,
                    onRetry: showRateLimited,
                }),
            queueId: queue.id,
            signal: controller.signal,
            // The page fetcher paces itself from the rate limit headers.
            pageDelayMs: 0,
            maxItems,
            onProgress: (progress) => {
                queued = progress.queued
                if (!controller.signal.aborted) showRunning()
            },
        })
        // A newer run owns the notification now.
        if (!run.owns(controller)) return
        // A finite duration on a key that had duration 0 must start as a new notification.
        notification.destroy(key)

        if (result.stoppedBy === "cancelled") {
            notification.warning({
                key,
                message: "Cancelled",
                description: `${count(result.queued)} traces queued to "${queueName}" before you stopped.`,
                duration: 6,
            })
            return
        }
        if (result.queued === 0) {
            notification.info({
                key,
                message: "Nothing queued",
                description: "No traces match this filter, so nothing was queued.",
                duration: 6,
            })
            return
        }
        notification.success({
            key,
            message: `Queued ${count(result.queued)} traces`,
            description:
                result.stoppedBy === "cap"
                    ? `Queued to "${queueName}". Hit the ${max}-trace limit for one run. ` +
                      `Narrow the filter to queue the rest. They'll appear as the queue processes.`
                    : `Queued to "${queueName}". They'll appear as the queue processes.`,
            duration: 6,
            btn: onViewQueue ? (
                <Button
                    size="sm"
                    onClick={() => {
                        notification.destroy(key)
                        onViewQueue(queue.id)
                    }}
                >
                    View queue
                </Button>
            ) : undefined,
        })
    } catch (error) {
        if (!run.owns(controller)) return
        notification.destroy(key)
        const retryButton = (
            <Button
                size="sm"
                variant="outline"
                onClick={() => {
                    notification.destroy(key)
                    void runAddAllMatching(input)
                }}
            >
                Retry
            </Button>
        )
        if (error instanceof BatchFlushError) {
            notification.error({
                key,
                message: "Queue add incomplete",
                description: `Queued ${count(error.flushedCount)} traces; ${count(error.failedCount)} failed to queue.`,
                duration: 0,
                btn: retryButton,
            })
            return
        }
        console.error("Adding all matching traces to a queue failed", error)
        notification.error({
            key,
            message: "Queue add failed",
            description: "Something went wrong. Try again.",
            duration: 0,
            btn: retryButton,
        })
    }
}
