/*
 * Main-thread helper for the evalRunner bulk-fetch web-worker.
 * Lazily spins up a single instance of the worker and multiplexes requests
 * by a generated requestId.
 */

import type {UseEvaluationRunScenarioStepsFetcherResult} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"

import {serializeRunIndex} from "../../hooks/useEvaluationRunData/assets/helpers/buildRunIndex"

import type {WorkerEvalContext} from "./workerFetch"

type RawEntry = [string, UseEvaluationRunScenarioStepsFetcherResult]

interface FetchBulkChunkMessage {
    type: "chunk"
    requestId: string
    json: string // stringified RawEntry[]
}

interface FetchBulkDoneMessage {
    type: "done"
    requestId: string
}

interface FetchBulkErrorMessage {
    type: "error"
    requestId: string
    error: string
}

type WorkerMessage = FetchBulkChunkMessage | FetchBulkDoneMessage | FetchBulkErrorMessage

interface Pending {
    resolve: (v: Map<string, UseEvaluationRunScenarioStepsFetcherResult>) => void
    reject: (e: unknown) => void
    timer: ReturnType<typeof setTimeout>
    buffer: Map<string, UseEvaluationRunScenarioStepsFetcherResult>
    onChunk?: (chunk: Map<string, UseEvaluationRunScenarioStepsFetcherResult>) => void
}

let worker: Worker | null = null
const pendings = new Map<string, Pending>()

function ensureWorker() {
    if (worker) return
    // Bundler-friendly URL construction

    // @ts-ignore
    worker = new Worker(new URL("./fetchSteps.worker.ts", import.meta.url), {type: "module"})
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const msg = event.data as WorkerMessage
        // console.log("[bulkWorker] received", msg)
        const pending = pendings.get(msg.requestId)
        if (!pending) return

        // console.log("worker done")
        switch (msg.type) {
            case "chunk": {
                queueMicrotask(() => {
                    const entries: RawEntry[] = JSON.parse(msg.json)
                    const chunkMap = new Map<string, UseEvaluationRunScenarioStepsFetcherResult>()
                    for (const [id, data] of entries) {
                        pending.buffer.set(id, data)
                        chunkMap.set(id, data)
                    }
                    if (pending.onChunk) {
                        try {
                            pending.onChunk(chunkMap)
                        } catch (err) {
                            console.error("[bulkWorker] onChunk error", err)
                        }
                    }
                    // console.log(`[bulkWorker] buffer size now ${pending.buffer.size}`)
                })
                break
            }
            case "done": {
                // console.log(`[bulkWorker] done for ${msg.requestId}, total ${pending.buffer.size}`)
                clearTimeout(pending.timer)
                pendings.delete(msg.requestId)
                pending.resolve(pending.buffer)
                break
            }
            case "error": {
                clearTimeout(pending.timer)
                pendings.delete(msg.requestId)
                console.error(`[bulkWorker] error from worker`, msg.error)
                pending.reject(new Error(msg.error))
                break
            }
            default:
                break
        }
    }
}

const DEFAULT_WORKER_TIMEOUT_MS = 120_000

export async function fetchStepsViaWorker(
    scenarioIds: string[],
    context: WorkerEvalContext,
    opts: {
        timeoutMs?: number
        onChunk?: (chunk: Map<string, UseEvaluationRunScenarioStepsFetcherResult>) => void
    } = {},
): Promise<Map<string, UseEvaluationRunScenarioStepsFetcherResult>> {
    const {timeoutMs = DEFAULT_WORKER_TIMEOUT_MS, onChunk} = opts
    if (typeof Worker === "undefined") {
        throw new Error("Web Workers not supported in this environment")
    }
    ensureWorker()
    const requestId = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) as string
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pendings.delete(requestId)
            reject(new Error(`Worker request timed out after ${timeoutMs} ms`))
        }, timeoutMs)
        pendings.set(requestId, {
            resolve,
            reject,
            timer,
            buffer: new Map(),
            onChunk,
        })
        worker!.postMessage({
            type: "fetch-bulk",
            requestId,
            scenarioIds,
            context: {
                apiUrl: context.apiUrl,
                evaluators: context.evaluators,
                jwt: context.jwt,
                projectId: context.projectId,
                runIndex: serializeRunIndex(context.runIndex),
                members: context.members,
                runId: context.runId,
                mappings: context.mappings,
                testsets: context.testsets,
                variants: context.variants,
            },
        })
    })
}
