import {simpleQueueMolecule, type SimpleQueue} from "@agenta/entities/simpleQueue"
import {addAllMatchingTracesToQueue, BatchFlushError} from "@agenta/entities/simpleQueue/etl"
import {inferQueueMaxFromPlan} from "@agenta/entities/trace/etl"
import {
    buildTraceQueryParams,
    createAdaptiveTracePageFetcher,
    withRateLimitRetry,
} from "@agenta/observability"
import {axios, getAgentaApiUrl, getHostQueryClient, isBillingEnabled} from "@agenta/shared/api"
import {message} from "@agenta/ui/app-message"
import type {NoticeType} from "@agenta/ui/app-message"

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
            // The request of `fetchCurrentSubscription` in `@agenta/settings-ui`. Its barrel is
            // not imported here: whatever this chunk takes from a barrel the app shell also
            // loads lands in the shell.
            queryFn: async () =>
                (
                    await axios.get<{plan?: string | null} | null>(
                        `${getAgentaApiUrl()}/billing/subscription`,
                        {params: {project_id: projectId}},
                    )
                ).data,
            staleTime: 1000 * 60 * 5,
        })
        .catch(() => null)
    return inferQueueMaxFromPlan(subscription?.plan)
}

const count = (value: number) => value.toLocaleString()

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
 * Scans every trace that matches the traces page query and adds the trace ids to `queue`, with a
 * toast that shows the progress and how the run ended. Retry starts the whole scan again,
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

    // One toast per queue, updated in place as the run goes on.
    const show = ({type, title, description, duration, action}: Toast) =>
        message.open({
            key,
            type,
            duration,
            action,
            content: <QueueToast title={title} description={description} />,
        })
    const cancel = {label: "Cancel", onClick: () => controller.abort()}
    let queued = 0
    const showRunning = () =>
        show({
            type: "loading",
            title: `Queuing traces to "${queueName}"`,
            description: `Queued ${count(queued)} of up to ${max} traces…`,
            duration: 0,
            action: cancel,
        })
    const showRateLimited = (delayMs: number) => {
        if (!run.owns(controller)) return
        show({
            type: "loading",
            title: "Rate limited, pausing",
            description:
                `Queued ${count(queued)} of up to ${max} traces. The server is throttling ` +
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
        // A newer run owns the toast now.
        if (!run.owns(controller)) return

        if (result.stoppedBy === "cancelled") {
            show({
                type: "warning",
                title: "Cancelled",
                description: `${count(result.queued)} traces queued to "${queueName}" before you stopped.`,
                duration: 6,
            })
            return
        }
        if (result.queued === 0) {
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
            title: `Queued ${count(result.queued)} traces`,
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
        if (!run.owns(controller)) return
        const retry = {label: "Retry", onClick: () => void runAddAllMatching(input)}
        if (error instanceof BatchFlushError) {
            show({
                type: "error",
                title: "Queue add incomplete",
                description: `Queued ${count(error.flushedCount)} traces; ${count(error.failedCount)} failed to queue.`,
                duration: 0,
                action: retry,
            })
            return
        }
        console.error("Adding all matching traces to a queue failed", error)
        show({
            type: "error",
            title: "Queue add failed",
            description: "Something went wrong. Try again.",
            duration: 0,
            action: retry,
        })
    }
}
