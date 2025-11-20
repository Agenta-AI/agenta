import {v4 as uuid} from "uuid"

import type {IScenario} from "@/oss/lib/hooks/useEvaluationRunScenarios/types"

// Dynamically imported to avoid main bundle weight
let _worker: Worker | null = null
function getWorker() {
    if (!_worker) {
        _worker = new Worker(
            new URL("@/oss/lib/workers/evalRunner/scenarioListWorker.ts", import.meta.url),
            {
                type: "module",
            },
        )
    }
    return _worker
}

interface Params {
    apiUrl: string
    jwt: string
    projectId: string
    runId: string
}

export async function fetchScenarioListViaWorker(
    params: Params,
    timeoutMs = 120000,
): Promise<IScenario[]> {
    const worker = getWorker()
    const requestId = uuid()
    // console.log("[fetchScenarioListViaWorker]", params)
    return new Promise<IScenario[]>((resolve, reject) => {
        const handle = (e: MessageEvent<any>) => {
            const {requestId: rid, ok, data, error} = e.data
            if (rid !== requestId) return
            worker.removeEventListener("message", handle)
            clearTimeout(timer)
            if (ok) resolve(data as IScenario[])
            else reject(new Error(error))
        }
        worker.addEventListener("message", handle)
        const timer = setTimeout(() => {
            worker.removeEventListener("message", handle)
            reject(new Error("scenario list worker timeout"))
        }, timeoutMs)
        worker.postMessage({requestId, payload: params})
    })
}
