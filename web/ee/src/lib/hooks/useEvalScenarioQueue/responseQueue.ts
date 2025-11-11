export interface QueueItem<T> {
    payload: T
    receivedAt: number
}

/**
 * Generic in-memory batching queue. Push items and they will be flushed
 * either when we reach `maxBatch` length or after `maxWaitMs` timeout,
 * whichever comes first. The consumer provides a `processBatch` callback
 * that receives all pending items in the order they were received.
 */
export class BatchingQueue<T> {
    private pending: QueueItem<T>[] = []
    private flushTimer: ReturnType<typeof setTimeout> | null = null

    constructor(
        private readonly processBatch: (items: QueueItem<T>[]) => void,
        private readonly maxBatch = 20,
        private readonly maxWaitMs = 150,
    ) {}

    push(item: T) {
        this.pending.push({payload: item, receivedAt: Date.now()})
        // If we already reached the batch size, flush synchronously
        if (this.pending.length >= this.maxBatch) {
            this.flush()
            return
        }
        // Otherwise ensure a timer exists
        if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => this.flush(), this.maxWaitMs)
        }
    }

    flush() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer)
            this.flushTimer = null
        }
        if (this.pending.length === 0) return
        const batch = this.pending.splice(0, this.pending.length)
        try {
            this.processBatch(batch)
        } catch (err) {
            console.error("[BatchingQueue] processBatch failed", err)
        }
    }
}
