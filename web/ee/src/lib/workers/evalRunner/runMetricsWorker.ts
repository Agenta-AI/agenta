/*
Main-thread helper to communicate with fetchRunMetrics.worker.ts.
Ensures single worker instance and multiplexes requests by requestId.
*/

// import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"

interface FetchResultMessage {
    requestId: string
    ok: boolean
    data?: any[]
    stats?: Record<string, any>
    error?: string
}

interface Pending {
    resolve: (v: {metrics: any[]; stats: Record<string, any>}) => void
    reject: (e: unknown) => void
    timer: ReturnType<typeof setTimeout>
}

let worker: Worker | null = null
const pendings = new Map<string, Pending>()

function ensureWorker() {
    if (worker) return
    // @ts-ignore
    worker = new Worker(new URL("./fetchRunMetrics.worker.ts", import.meta.url), {type: "module"})
    worker.onmessage = (event: MessageEvent<FetchResultMessage>) => {
        const msg = event.data
        const pending = pendings.get(msg.requestId)
        if (!pending) return
        clearTimeout(pending.timer)
        pendings.delete(msg.requestId)
        if (!msg.ok) {
            pending.reject(new Error(msg.error || "worker error"))
            return
        }
        pending.resolve({metrics: msg.data || [], stats: msg.stats || {}})
    }
}

export async function fetchRunMetricsViaWorker(
    runId: string,
    context: {
        apiUrl: string
        jwt: string
        projectId: string
        evaluatorSlugs: string[]
        revisionSlugs: string[]
    },
    timeoutMs = 30000,
): Promise<{metrics: any[]; stats: Record<string, any>}> {
    if (typeof Worker === "undefined") throw new Error("Workers unsupported")
    ensureWorker()
    const requestId = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) as string
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pendings.delete(requestId)
            reject(new Error("Worker timeout"))
        }, timeoutMs)
        pendings.set(requestId, {resolve, reject, timer})
        worker!.postMessage({requestId, payload: {...context, runId}})
    })
}
