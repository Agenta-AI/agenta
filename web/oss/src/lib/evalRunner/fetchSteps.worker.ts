// Web Worker for bulk scenario steps fetching & enrichment
// Receives {type: "fetch-bulk", requestId, scenarioIds, context}
// Responds with {type: "result", requestId, entries: [ [scenarioId, enrichedResult] ] }

import {fetchScenarioStepsBulkWorker} from "./workerFetch"
import type {WorkerEvalContext} from "./workerFetch"

export interface FetchBulkMessage {
    type: "fetch-bulk"
    requestId: string
    scenarioIds: string[]
    context: WorkerEvalContext
}

export interface FetchBulkChunkMessage {
    type: "chunk"
    requestId: string
    json: string // stringified RawEntry[]
}

export interface FetchBulkDoneMessage {
    type: "done"
    requestId: string
}

type OutgoingMessage =
    | FetchBulkChunkMessage
    | FetchBulkDoneMessage
    | {
          type: "error"
          requestId: string
          error: string
      }

self.onmessage = (event: MessageEvent<FetchBulkMessage>) => {
    const msg = event.data
    if (msg.type !== "fetch-bulk") return

    const {requestId, scenarioIds, context} = msg

    fetchScenarioStepsBulkWorker(scenarioIds, context)
        .then((map) => {
            const CHUNK_SIZE = 200

            const entries = Array.from(map.entries())
            ;(async () => {
                for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
                    const chunkEntries = entries.slice(i, i + CHUNK_SIZE)
                    const msg: OutgoingMessage = {
                        type: "chunk",
                        requestId,
                        json: JSON.stringify(chunkEntries),
                    }
                    // @ts-ignore
                    self.postMessage(msg)

                    // allow main thread to breathe
                    await new Promise((r) => setTimeout(r, 300)) // ~1 frame @60fps
                }
                const done: OutgoingMessage = {type: "done", requestId}
                // @ts-ignore
                self.postMessage(done)
            })()
        })
        .catch((err) => {
            // Post error back so main thread can handle
            const errorMsg: OutgoingMessage = {
                type: "error",
                requestId,
                error: err && err.message ? err.message : String(err ?? "unknown"),
            }
            // @ts-ignore
            self.postMessage(errorMsg)
        })
}
