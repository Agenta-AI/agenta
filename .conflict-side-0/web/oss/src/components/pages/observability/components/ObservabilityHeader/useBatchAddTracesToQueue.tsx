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
import {addAllMatchingTracesToQueue, BatchFlushError} from "@agenta/entities/simpleQueue/etl"
import {notification} from "@agenta/ui/app-message"
import {Button} from "antd"
import {useAtomValue} from "jotai"

import {queueMaxItemsAtom} from "@/oss/state/access/atoms"
import type {Condition} from "@/oss/state/newObservability/atoms/queryHelpers"
import {createAdaptiveTracePageFetcher} from "@/oss/state/newObservability/etl/adaptiveTracePageFetcher"
import {withRateLimitRetry} from "@/oss/state/newObservability/etl/withRateLimitRetry"
/** Auto-dismiss window for the success toast; rendered as a visible progress bar. */
const SUCCESS_DISMISS_MS = 5_000

/** Brand primary used for the auto-dismiss countdown bar (matches antd's `colorPrimary`). */
const PRIMARY_COLOR = "#1c2c3d"

/**
 * Description wrapper that drives the success toast's own auto-dismiss timer:
 * a CSS-transitioned bar shrinks to zero over `durationMs`, a single
 * `setTimeout` fires `onComplete` at the same instant. Driving the bar via
 * CSS (not React state) keeps the visible end-of-countdown and the toast
 * dismissal in perfect sync — no "bar already at 0% but the toast still
 * sitting there" gap, and no "toast already fading but the bar mid-animation"
 * either. A short countdown label ("Dismissing in Ns") tells the user what's
 * about to happen.
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
    const totalSeconds = Math.max(1, Math.ceil(durationMs / 1000))
    const [secondsLeft, setSecondsLeft] = useState(totalSeconds)
    // CSS transitions only animate when the value CHANGES post-mount, so
    // we start at 100% and flip to 0% on the first commit. The flip has to
    // wait one frame so the browser registers the initial 100% layout.
    const [barWidth, setBarWidth] = useState("100%")
    // Pin the latest onComplete so the dismiss timeout never fires a stale
    // closure (e.g. when a parent re-renders with a new handler).
    const onCompleteRef = useRef(onComplete)
    onCompleteRef.current = onComplete

    useEffect(() => {
        const raf = window.requestAnimationFrame(() => setBarWidth("0%"))
        const startedAt = Date.now()
        const tick = window.setInterval(() => {
            const remainingMs = Math.max(0, durationMs - (Date.now() - startedAt))
            // Never display "0s" — the dismissal fires when we'd reach it,
            // and showing "Dismissing in 0s" reads awkwardly.
            setSecondsLeft(remainingMs > 0 ? Math.max(1, Math.ceil(remainingMs / 1000)) : 0)
        }, 250)
        const dismiss = window.setTimeout(() => onCompleteRef.current(), durationMs)
        return () => {
            window.cancelAnimationFrame(raf)
            window.clearInterval(tick)
            window.clearTimeout(dismiss)
        }
    }, [durationMs])

    return (
        <div>
            <div>{text}</div>
            <div className="mt-2 flex items-center gap-2">
                <div className="relative flex-1 h-1 bg-gray-200 rounded overflow-hidden">
                    <div
                        className="absolute inset-y-0 left-0 rounded"
                        style={{
                            width: barWidth,
                            backgroundColor: PRIMARY_COLOR,
                            transition: `width ${durationMs}ms linear`,
                        }}
                    />
                </div>
                <span className="text-xs text-gray-500 whitespace-nowrap">
                    {secondsLeft > 0 ? `Dismissing in ${secondsLeft}s` : "Dismissing…"}
                </span>
            </div>
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

    // Tier-aware per-run cap — derived from the current billing plan.
    // Hobby/free deployments stay at the historical 1k default; pro,
    // business, enterprise unlock progressively higher caps. The mapping
    // lives in `@agenta/entities/trace/etl` so it's unit-tested.
    const maxItems = useAtomValue(queueMaxItemsAtom)

    // Navigating away from observability aborts the run (partial add).
    useEffect(() => () => abortRef.current?.abort(), [])

    const run = useCallback(
        (input: BatchAddRunInput) => {
            const {queue, scanConfig, viewQueueUrl} = input
            const queueName = queue.name || "queue"
            const key = `batch-add-queue-${queue.id}`
            // Capture the cap (and its formatted label) at run-time so a
            // plan upgrade between runs picks up the new ceiling, but a
            // single run quotes a consistent number throughout its toast.
            const maxLabel = maxItems.toLocaleString()

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
                    description: `Queued ${queued.toLocaleString()} of up to ${maxLabel} traces…`,
                    duration: 0,
                    btn: cancelBtn,
                })
            }

            const showRateLimited = (delayMs: number) => {
                notification.open({
                    key,
                    message: "Rate limited — pausing",
                    description:
                        `Queued ${lastQueued.toLocaleString()} of up to ${maxLabel} traces. ` +
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
                        // Tier-aware ceiling (1k hobby → 20k enterprise).
                        maxItems,
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
                        ? `Queued to "${queueName}". Hit the ${maxLabel}-trace limit ` +
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
        },
        [maxItems],
    )

    runRef.current = run

    return run
}
