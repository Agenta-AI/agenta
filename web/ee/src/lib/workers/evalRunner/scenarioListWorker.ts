/*
Web Worker: Fetch full scenario list for a preview evaluation run in the background.
It expects a message of shape:
{
  requestId: string;
  payload: {
    apiUrl: string;
    jwt: string;
    projectId: string;
    runId: string;
  }
}
It will paginate through the /preview/evaluations/scenarios/ endpoint and post back:
{ requestId, ok: true, data: scenarios[] } or { requestId, ok:false, error }
*/

import type {IScenario} from "@/oss/lib/hooks/useEvaluationRunScenarios/types"

interface WorkerRequest {
    requestId: string
    payload: {
        apiUrl: string
        jwt: string
        projectId: string
        runId: string
    }
}

interface WorkerResponse {
    requestId: string
    ok: boolean
    data?: IScenario[]
    error?: string
}

// Backend supports cursor-based pagination (windowing with `next`) but not
// an explicit numeric `offset`. Fetch scenarios in smaller batches to
// reduce main-thread work when large evaluations load.
const PAGE_SIZE = 100

interface FetchArgs {
    apiUrl: string
    jwt: string
    projectId: string
    runId: string
    next?: string | null
    limit: number
}

async function fetchPage({
    apiUrl,
    jwt,
    projectId,
    runId,
    next,
    limit,
}: FetchArgs): Promise<IScenario[]> {
    const queryParams = new URLSearchParams()
    if (runId) {
        queryParams.append("run_ids", `{${runId}}`)
        queryParams.append("limit", limit.toString())
        if (next) queryParams.append("next", next)
        queryParams.append("project_id", projectId)
    }

    const url = `${apiUrl}/preview/evaluations/scenarios/?${queryParams.toString()}`
    const res = await fetch(url, {
        headers: {Authorization: `Bearer ${jwt}`},
    })
    if (!res.ok) throw new Error(`fetch ${res.status}`)
    const json = (await res.json()) as {scenarios?: IScenario[]}
    return json.scenarios ?? []
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
    const {requestId, payload} = e.data
    try {
        const scenarios: IScenario[] = []
        let next: string | null | undefined = null
        let batch = 0
        do {
            const page = await fetchPage({
                ...payload,
                next,
                limit: PAGE_SIZE,
            })
            scenarios.push(...page)
            batch += 1
            next = page.length === PAGE_SIZE ? page[page.length - 1]?.id : null
        } while (next)

        // Deduplicate scenarios by id in case backend returned duplicates
        const seen = new Set<string>()
        const uniqueScenarios = scenarios.filter((s) => {
            if (seen.has(s.id)) return false
            seen.add(s.id)
            return true
        })

        const resp: WorkerResponse = {requestId, ok: true, data: uniqueScenarios}
        // @ts-ignore
        self.postMessage(resp)
    } catch (err: any) {
        const resp: WorkerResponse = {requestId, ok: false, error: err.message || "unknown"}
        // @ts-ignore
        self.postMessage(resp)
    }
}
