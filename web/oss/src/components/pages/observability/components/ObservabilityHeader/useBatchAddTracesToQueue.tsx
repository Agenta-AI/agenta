/**
 * useBatchAddTracesToQueue — drives the filter-scoped "add all matching traces
 * to a queue" run plus its non-blocking progress notification.
 *
 * Picking a queue starts a background ETL scan (`addAllMatchingTracesToQueue`);
 * the notification shows a live counter + Cancel and resolves to a terminal
 * state (done / nothing-queued / cancelled / partial-error). Copy says
 * "queued", never "added" — `evaluate_batch_traces` is fire-and-forget, so the
 * counter reflects IDs submitted, not scenarios materialized.
 */

import {useCallback, useEffect, useRef} from "react"

import type {SimpleQueue} from "@agenta/entities/simpleQueue"
import {notification} from "@agenta/ui/app-message"
import {Button, Space} from "antd"

import {
    addAllMatchingTracesToQueue,
    QueueAddError,
} from "@/oss/state/newObservability/etl/addMatchingTracesToQueue"
import type {TraceScanParams} from "@/oss/state/newObservability/etl/traceSource"

export interface BatchAddRunInput {
    queue: SimpleQueue
    scan: TraceScanParams
    /** Link target for the "View queue" action in the success notification. */
    viewQueueUrl?: string
}

export const useBatchAddTracesToQueue = () => {
    // Latest in-flight run — a new run or unmount aborts it.
    const abortRef = useRef<AbortController | null>(null)
    // Self-reference so the partial-error notification's Retry can re-run.
    const runRef = useRef<(input: BatchAddRunInput) => void>(() => {})

    // Navigating away from observability aborts the run (partial add).
    useEffect(() => () => abortRef.current?.abort(), [])

    const run = useCallback((input: BatchAddRunInput) => {
        const {queue, scan, viewQueueUrl} = input
        const queueName = queue.name || "queue"
        const key = `batch-add-queue-${queue.id}`

        // One run at a time per hook instance.
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller

        const showRunning = (queued: number) => {
            notification.open({
                key,
                message: `Queuing traces to "${queueName}"`,
                description: `Queued ${queued.toLocaleString()} traces so far…`,
                duration: 0,
                btn: (
                    <Button size="small" onClick={() => controller.abort()}>
                        Cancel
                    </Button>
                ),
            })
        }

        showRunning(0)

        void (async () => {
            try {
                const result = await addAllMatchingTracesToQueue({
                    scan,
                    queueId: queue.id,
                    signal: controller.signal,
                    onProgress: ({queued}) => {
                        if (!controller.signal.aborted) showRunning(queued)
                    },
                })

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

                const capNote = result.stoppedBy === "cap" ? " (scan limit reached)" : ""
                notification.success({
                    key,
                    message: `Queued ${result.queued.toLocaleString()} traces`,
                    description: `Queued to "${queueName}"${capNote}. They'll appear as the queue processes.`,
                    duration: 8,
                    btn: viewQueueUrl ? (
                        <Button size="small" type="primary" href={viewQueueUrl}>
                            View queue
                        </Button>
                    ) : undefined,
                })
            } catch (err) {
                if (err instanceof QueueAddError) {
                    notification.error({
                        key,
                        message: "Queue add incomplete",
                        description: `Queued ${err.queuedCount.toLocaleString()} traces; ${err.failedCount.toLocaleString()} failed to queue.`,
                        duration: 0,
                        btn: (
                            <Space>
                                <Button
                                    size="small"
                                    onClick={() => {
                                        notification.destroy(key)
                                        runRef.current(input)
                                    }}
                                >
                                    Retry
                                </Button>
                            </Space>
                        ),
                    })
                    return
                }
                notification.error({
                    key,
                    message: "Queue add failed",
                    description: err instanceof Error ? err.message : "Something went wrong.",
                    duration: 0,
                })
            } finally {
                if (abortRef.current === controller) abortRef.current = null
            }
        })()
    }, [])

    runRef.current = run

    return run
}
