/**
 * Generic batch fetcher helper that collects individual key requests
 * for a short window and executes a single bulk fetch.
 *
 * This mirrors the helper used in evaluation atoms so other areas
 * can reuse the same batching behaviour without duplicating logic.
 */

export type BatchFetcher<K, V> = (key: K) => Promise<V>

export type BatchFnResponse<K, V> =
    | Map<K, V>
    | Map<string, V>
    | Record<string, V>
    | {has: (key: K | string) => boolean; get: (key: K | string) => V | undefined}

export interface BatchFetcherOptions<K, V, R = BatchFnResponse<K, V>> {
    batchFn: (keys: K[], serializedKeys: string[]) => Promise<R>
    serializeKey?: (key: K) => string
    resolveResult?: (response: R, key: K, serializedKey: string) => V | undefined
    flushDelay?: number
    onError?: (error: unknown, keys: K[]) => void
    maxBatchSize?: number
}

interface PendingEntry<K, V> {
    key: K
    serializedKey: string
    resolvers: ((value: V) => void)[]
    rejecters: ((reason?: unknown) => void)[]
}

const DEFAULT_FLUSH_DELAY = 16 * 5 // approx. one frame at 60Hz

const defaultSerializeKey = <K>(key: K) => {
    if (typeof key === "string" || typeof key === "number" || typeof key === "boolean") {
        return String(key)
    }
    if (key && typeof key === "object") {
        return JSON.stringify(key)
    }
    return String(key)
}

const defaultResolveResult = <K, V, R = BatchFnResponse<K, V>>(
    response: R,
    _key: K,
    serializedKey: string,
): V | undefined => {
    if (!response) return undefined
    if (response instanceof Map) {
        // Try both original key type and serialized string key
        // Cast needed: Map<K,V>.has() doesn't accept different key types
        if (response.has(serializedKey as K)) {
            return response.get(serializedKey as K)
        }
        // Also try string key for Map<string, V>
        const stringMap = response as Map<string, V>
        if (stringMap.has(serializedKey)) {
            return stringMap.get(serializedKey)
        }
    }
    if (typeof (response as Record<string, V>)[serializedKey] !== "undefined") {
        return (response as Record<string, V>)[serializedKey]
    }
    // Handle map-like objects with has/get methods
    const maybeMapLike = response as {
        has?: (key: string) => boolean
        get?: (key: string) => V | undefined
    }

    if (typeof maybeMapLike?.has === "function" && typeof maybeMapLike?.get === "function") {
        return maybeMapLike.has(serializedKey) ? maybeMapLike.get(serializedKey) : undefined
    }
    return undefined
}

const chunk = <T>(input: T[], size: number) => {
    if (size <= 0) return [input]
    const output: T[][] = []
    for (let index = 0; index < input.length; index += size) {
        output.push(input.slice(index, index + size))
    }
    return output
}

export const createBatchFetcher = <K, V, R = BatchFnResponse<K, V>>({
    batchFn,
    serializeKey = defaultSerializeKey,
    resolveResult = defaultResolveResult,
    flushDelay = DEFAULT_FLUSH_DELAY,
    onError,
    maxBatchSize,
}: BatchFetcherOptions<K, V, R>): BatchFetcher<K, V> => {
    let pending = new Map<string, PendingEntry<K, V>>()
    const inflight = new Map<string, Promise<V>>()
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleFlush = () => {
        if (flushTimer) return
        flushTimer = setTimeout(flushPending, flushDelay)
    }

    const runBatch = async (entries: PendingEntry<K, V>[]) => {
        const keys = entries.map((entry) => entry.key)
        const serializedKeys = entries.map((entry) => entry.serializedKey)
        let response: R
        try {
            response = await batchFn(keys, serializedKeys)
        } catch (error) {
            onError?.(error, keys)
            entries.forEach((entry) => {
                entry.rejecters.forEach((reject) => reject(error))
            })
            return
        }

        entries.forEach((entry) => {
            try {
                const value = resolveResult(response, entry.key, entry.serializedKey)
                if (typeof value === "undefined") {
                    throw new Error(
                        `Batch fetcher did not receive data for key "${entry.serializedKey}"`,
                    )
                }
                entry.resolvers.forEach((resolve) => resolve(value))
            } catch (error) {
                entry.rejecters.forEach((reject) => reject(error))
            }
        })
    }

    const flushPending = () => {
        flushTimer = null
        if (pending.size === 0) {
            return
        }

        const entries = Array.from(pending.values())
        pending = new Map()

        if (maxBatchSize && maxBatchSize > 0 && entries.length > maxBatchSize) {
            const batches = chunk(entries, maxBatchSize)
            batches.forEach((batch) => {
                void runBatch(batch)
            })
        } else {
            void runBatch(entries)
        }
    }

    return (key: K) => {
        const serializedKey = serializeKey(key)
        const inflightPromise = inflight.get(serializedKey)
        if (inflightPromise) {
            return inflightPromise
        }

        // If a request for this key is already pending (but not yet flushed),
        // return a new promise that shares the same resolvers/rejecters array.
        // This is intentional: both promises will resolve together when the batch completes.
        // Note: This promise is NOT added to `inflight` since only the first request
        // for a key gets tracked there (after flush). This is fine because all callers
        // share the same pending entry and will be resolved together.
        const entry = pending.get(serializedKey)
        if (entry) {
            return new Promise<V>((resolve, reject) => {
                entry.resolvers.push(resolve)
                entry.rejecters.push(reject)
            })
        }

        const pendingEntry: PendingEntry<K, V> = {
            key,
            serializedKey,
            resolvers: [],
            rejecters: [],
        }
        pending.set(serializedKey, pendingEntry)

        const promise = new Promise<V>((resolve, reject) => {
            pendingEntry.resolvers.push(resolve)
            pendingEntry.rejecters.push(reject)
        }).finally(() => {
            inflight.delete(serializedKey)
        })
        inflight.set(serializedKey, promise)

        scheduleFlush()

        return promise
    }
}

export default createBatchFetcher
