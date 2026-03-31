interface RunVariantRowPayload {
    rowId: string
    entityId: string
    runId: string
    messageId?: string
    invocationUrl: string
    requestBody: Record<string, unknown>
    headers?: Record<string, string>
    repetitions?: number
}

// Track in-flight requests so we can cancel them by runId
const abortControllers = new Map<string, AbortController>()

// Simple p-limit implementation to avoid adding dependencies
const pLimit = (concurrency: number) => {
    const queue: (() => Promise<void>)[] = []
    let activeCount = 0

    const next = () => {
        activeCount--
        if (queue.length > 0) {
            queue.shift()?.()
        }
    }

    const run = async <T>(
        fn: () => Promise<T>,
        resolve: (value: T | PromiseLike<T>) => void,
        reject: (reason?: unknown) => void,
    ) => {
        activeCount++
        const result = (async () => fn())()
        try {
            const res = await result
            resolve(res)
        } catch (err) {
            reject(err)
        } finally {
            next()
        }
    }

    const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
        return new Promise<T>((resolve, reject) => {
            const task = () => run(fn, resolve, reject)

            if (activeCount < concurrency) {
                task()
            } else {
                queue.push(task)
            }
        })
    }

    return enqueue
}

// Global limiter instance to share concurrency limit across all runVariantRow calls.
const limit = pLimit(6)

const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    return value as Record<string, unknown>
}

const parseErrorMessage = (status: number, data: unknown, fallbackText = ""): string => {
    if (status === 429) {
        const detailRec = asRecord(data)
        const detail =
            (typeof detailRec?.detail === "string" && detailRec.detail) ||
            (typeof data === "string" ? data : "API rate limit exceeded")
        return detail
    }

    const rec = asRecord(data)
    const statusRec = asRecord(rec?.status)
    const detailRec = asRecord(rec?.detail)

    if (typeof statusRec?.message === "string" && statusRec.message.trim().length > 0) {
        return statusRec.message
    }
    if (typeof detailRec?.message === "string" && detailRec.message.trim().length > 0) {
        return detailRec.message
    }
    if (typeof rec?.detail === "string" && rec.detail.trim().length > 0) {
        return rec.detail
    }
    if (typeof fallbackText === "string" && fallbackText.trim().length > 0) {
        return fallbackText
    }
    return `Request failed with status ${status}`
}

const executeRequest = async (payload: RunVariantRowPayload, controller: AbortController) => {
    try {
        const response = await fetch(payload.invocationUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "ngrok-skip-browser-warning": "1",
                ...(payload.headers || {}),
            },
            body: JSON.stringify(payload.requestBody),
            signal: controller.signal,
        })

        let data: unknown = null
        let responseText = ""

        try {
            responseText = await response.text()
            if (responseText) {
                try {
                    data = JSON.parse(responseText)
                } catch {
                    data = responseText
                }
            }
        } catch {
            data = null
        }

        if (!response.ok) {
            return {
                response: undefined,
                error: parseErrorMessage(response.status, data, responseText),
                metadata: {
                    timestamp: new Date().toISOString(),
                    statusCode: response.status,
                    retryAfter: response.headers.get("Retry-After") || undefined,
                    rawError: data,
                },
            }
        }

        return {
            response: data,
            metadata: {
                timestamp: new Date().toISOString(),
                statusCode: response.status,
            },
        }
    } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") {
            throw error
        }

        return {
            response: undefined,
            error: error instanceof Error ? error.message : "Unknown error",
            metadata: {
                timestamp: new Date().toISOString(),
                type: "network_error",
            },
        }
    }
}

async function runVariantRow(payload: RunVariantRowPayload) {
    const repetitions = Math.max(1, payload.repetitions || 1)
    const controller = new AbortController()
    abortControllers.set(payload.runId, controller)

    try {
        const tasks = Array.from({length: repetitions}).map(() =>
            limit(() => executeRequest(payload, controller)),
        )
        const results = await Promise.all(tasks)

        postMessage({
            type: "runVariantRowResult",
            payload: {
                rowId: payload.rowId,
                entityId: payload.entityId,

                runId: payload.runId,
                messageId: payload.messageId,
                result: results,
            },
        })
    } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") {
            return
        }

        postMessage({
            type: "runVariantRowResult",
            payload: {
                rowId: payload.rowId,
                entityId: payload.entityId,

                runId: payload.runId,
                messageId: payload.messageId,
                result: {
                    error: error instanceof Error ? error.message : String(error),
                    metadata: {
                        timestamp: new Date().toISOString(),
                        type: "execution_error",
                    },
                },
            },
        })
    } finally {
        abortControllers.delete(payload.runId)
    }
}

addEventListener("message", (event: MessageEvent<{type: string; payload: unknown}>) => {
    if (event.data.type === "ping") {
        postMessage("pong")
        return
    }

    if (event.data.type === "runVariantRow") {
        runVariantRow(event.data.payload as RunVariantRowPayload)
        return
    }

    if (event.data.type === "cancelRun") {
        const payload = asRecord(event.data.payload)
        const runId = typeof payload?.runId === "string" ? payload.runId : ""
        if (!runId) return

        const controller = abortControllers.get(runId)
        if (controller) {
            controller.abort()
            abortControllers.delete(runId)
        }
        return
    }

    postMessage({
        type: "error",
        payload: "Unknown message",
    })
})
