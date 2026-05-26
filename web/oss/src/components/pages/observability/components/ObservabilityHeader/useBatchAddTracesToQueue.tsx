/**
 * useBatchAddTracesToQueue — drives the filter-scoped "add all matching traces
 * to a queue" run plus its non-blocking progress notification.
 *
 * Picking a queue starts a background ETL scan (`addAllMatchingTracesToQueue`);
 * the notification shows a live counter + Cancel and resolves to a terminal
 * state (done / nothing-queued / cancelled / partial-error). A 429 from EE
 * throttling pauses the scan (`withRateLimitRetry`) rather than killing it —
 * the notification shows a "rate limited" state during the wait.
 *
 * The page-scan fetcher is built via `createAdaptiveTracePageFetcher`, so
 * outbound request pacing tracks the live `X-RateLimit-Remaining` /
 * `X-RateLimit-Limit` headers (bucket-aware, not tier-aware — the same
 * code is the right pace on every plan).
 *
 * Copy says "queued", never "added" — `evaluate_batch_traces` is
 * fire-and-forget, so the counter reflects IDs submitted, not scenarios
 * materialized.
 */

import {useCallback, useEffect, useRef, useState} from "react"

import {simpleQueueMolecule, type SimpleQueue} from "@agenta/entities/simpleQueue"
import {
    addAllMatchingTracesToQueue,
    BatchFlushError,
    DEFAULT_MAX_ITEMS,
} from "@agenta/entities/simpleQueue/etl"
import {notification} from "@agenta/ui/app-message"
import {Button, Progress} from "antd"

import type {Condition} from "@/oss/state/newObservability/atoms/queryHelpers"
import {createAdaptiveTracePageFetcher} from "@/oss/state/newObservability/etl/adaptiveTracePageFetcher"
import {withRateLimitRetry} from "@/oss/state/newObservability/etl/withRateLimitRetry"

/** Per-run cap on queued trace ids — mirrors the pipeline default. */
const MAX_ITEMS = DEFAULT_MAX_ITEMS
/** Pre-formatted cap for toast copy (e.g. "1,000"). */
const MAX_LABEL = MAX_ITEMS.toLocaleString()
/** Auto-dismiss window for the success toast; rendered as a visible progress bar. */
const SUCCESS_DISMISS_MS = 5_000

/**
 * Description wrapper that drives the success toast's own auto-dismiss timer:
 * counts down from `durationMs` to 0 (UI mirrored via a Progress bar), then
 * fires `onComplete` once. Antd's `duration` is set to 0 so this component is
 * the sole owner of the timing — keeps the visible countdown and the actual
 * dismissal in lockstep.
 */
const AutoDismissDescription = ({
    text,
    durationMs,
    onComplete,
}: {
    text: string
    durationMs: number
    onComplete: () => void
}) => {
    const [percent, setPercent] = useState(100)
    const completedRef = useRef(false)

    useEffect(() => {
        const startedAt = Date.now()
        const id = window.setInterval(() => {
            const remaining = Math.max(0, durationMs - (Date.now() - startedAt))
            setPercent((remaining / durationMs) * 100)
            if (remaining <= 0 && !completedRef.current) {
                completedRef.current = true
                window.clearInterval(id)
                onComplete()
            }
        }, 50)
        return () => window.clearInterval(id)
    }, [durationMs, onComplete])

    return (
        <div>
            <div>{text}</div>
            <Progress
                percent={percent}
                showInfo={false}
                strokeColor="#52c41a"
                size="small"
                className="!mt-2 !mb-0"
            />
        </div>
    )
}

/** Trace-scan params the hook needs to build the adaptive page fetcher. */
export interface BatchAddScanConfig {
    params: Record<string, any>
    appId: string
    isHasAnnotationSelected: number
    hasAnnotationConditions: Condition[]
    hasAnnotationOperator?: string
}

export interface BatchAddRunInput {
    queue: SimpleQueue
    /**
     * Trace-query params describing the live observability filter — the
     * hook builds an adaptive (bucket-aware) page fetcher from it.
     */
    scanConfig: BatchAddScanConfig
    /** Link target for the "View queue" action in the success notification. */
    viewQueueUrl?: string
}

export const useBatchAddTracesToQueue = () => {
    // Latest in-flight run — a new run or unmount aborts it.
    const abortRef = useRef<AbortController | null>(null)
    // Self-reference so the error notifications' Retry can re-run.
    const runRef = useRef<(input: BatchAddRunInput) => void>(() => {})

    // Navigating away from observability aborts the run (partial add).
    useEffect(() => () => abortRef.current?.abort(), [])

    const run = useCallback((input: BatchAddRunInput) => {
        const {queue, scanConfig, viewQueueUrl} = input
        const queueName = queue.name || "queue"
        const key = `batch-add-queue-${queue.id}`

        // One run at a time per hook instance.
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller

        // True only while this run still owns the toast key. A run superseded
        // by a newer run (same queue → same `key`) must stay silent on its
        // terminal toast, or it clobbers the live counter the new run owns.
        const isCurrentRun = () => abortRef.current === controller

        const cancelBtn = (
            <Button size="small" onClick={() => controller.abort()}>
                Cancel
            </Button>
        )

        // Last reported queued count — kept so the rate-limited state can
        // still show progress while the scan is paused.
        let lastQueued = 0

        const showRunning = (queued: number) => {
            lastQueued = queued
            notification.open({
                key,
                message: `Queuing traces to "${queueName}"`,
                description: `Queued ${queued.toLocaleString()} of up to ${MAX_LABEL} traces…`,
                duration: 0,
                btn: cancelBtn,
            })
        }

        const showRateLimited = (delayMs: number) => {
            notification.open({
                key,
                message: "Rate limited — pausing",
                description:
                    `Queued ${lastQueued.toLocaleString()} of up to ${MAX_LABEL} traces. ` +
                    `The server is throttling requests; retrying in ` +
                    `${Math.ceil(delayMs / 1000)}s…`,
                duration: 0,
                btn: cancelBtn,
            })
        }

        showRunning(0)

        // Shared adaptive fetcher: bucket-aware proactive pacing + 429 retry.
        // Same helper the bulk CSV export uses — pacing is driven by the live
        // `X-RateLimit-Remaining` / `X-RateLimit-Limit` headers from EE
        // throttling, not by an arbitrary constant.
        const fetchPage = createAdaptiveTracePageFetcher({
            ...scanConfig,
            signal: controller.signal,
            onRateLimitPause: (delayMs) => showRateLimited(delayMs),
        })

        // `addTraces` hits a different throttle bucket than the trace query,
        // so bucket-aware pacing for it would need its own readings. The 429
        // retry remains as the per-call safety net.
        const addTracesWithRetry = (queueId: string, traceIds: string[]) =>
            withRateLimitRetry(() => simpleQueueMolecule.set.addTraces(queueId, traceIds), {
                signal: controller.signal,
                onRetry: (delayMs) => showRateLimited(delayMs),
            })

        void (async () => {
            try {
                const result = await addAllMatchingTracesToQueue({
                    fetchPage,
                    addTraces: addTracesWithRetry,
                    queueId: queue.id,
                    signal: controller.signal,
                    // Pacing happens inside `fetchPage` based on live bucket
                    // state — disable the source-level fixed delay.
                    pageDelayMs: 0,
                    onProgress: ({queued}) => {
                        if (!controller.signal.aborted) showRunning(queued)
                    },
                })

                // A superseded run resolves as "cancelled" — bail before it
                // can overwrite the toast the newer run now owns.
                if (!isCurrentRun()) return

                // Antd's notification.{success,info,warning} called with an
                // existing key UPDATES the entry in place — and when the
                // previous entry was `duration: 0` (the running counter),
                // the timer doesn't kick in from the new finite duration.
                // Destroy first so each terminal toast lands as a fresh
                // notification that honours its own duration.
                notification.destroy(key)

                if (result.stoppedBy === "cancelled") {
                    notification.warning({
                        key,
                        message: "Cancelled",
                        description: `${result.queued.toLocaleString()} traces queued to "${queueName}" before you stopped.`,
                        duration: 6,
                    })
                    return
                }

                if (result.queued === 0) {
                    notification.info({
                        key,
                        message: "Nothing queued",
                        description: "No traces match this filter — nothing queued.",
                        duration: 6,
                    })
                    return
                }

                const capped = result.stoppedBy === "cap"
                const descriptionText = capped
                    ? `Queued to "${queueName}". Hit the ${MAX_LABEL}-trace limit ` +
                      `for one run — narrow the filter to queue the rest. ` +
                      `They'll appear as the queue processes.`
                    : `Queued to "${queueName}". They'll appear as the queue processes.`
                notification.success({
                    key,
                    message: `Queued ${result.queued.toLocaleString()} traces`,
                    description: (
                        <AutoDismissDescription
                            text={descriptionText}
                            durationMs={SUCCESS_DISMISS_MS}
                            onComplete={() => notification.destroy(key)}
                        />
                    ),
                    // Owned by `AutoDismissDescription` — antd's timer is disabled
                    // so the visible countdown and the dismissal stay in sync.
                    duration: 0,
                    btn: viewQueueUrl ? (
                        <Button
                            size="small"
                            type="primary"
                            href={viewQueueUrl}
                            onClick={() => notification.destroy(key)}
                        >
                            View queue
                        </Button>
                    ) : undefined,
                })
            } catch (err) {
                // Stale runs never reach here (an abort resolves, not rejects),
                // but guard anyway so a superseded run can't surface an error.
                if (!isCurrentRun()) return

                const retryBtn = (
                    <Button
                        size="small"
                        onClick={() => {
                            notification.destroy(key)
                            runRef.current(input)
                        }}
                    >
                        Retry
                    </Button>
                )

                if (err instanceof BatchFlushError) {
                    notification.error({
                        key,
                        message: "Queue add incomplete",
                        description: `Queued ${err.flushedCount.toLocaleString()} traces; ${err.failedCount.toLocaleString()} failed to queue.`,
                        duration: 0,
                        btn: retryBtn,
                    })
                    return
                }
                notification.error({
                    key,
                    message: "Queue add failed",
                    description: err instanceof Error ? err.message : "Something went wrong.",
                    duration: 0,
                    btn: retryBtn,
                })
            } finally {
                if (abortRef.current === controller) abortRef.current = null
            }
        })()
    }, [])

    runRef.current = run

    return run
}
