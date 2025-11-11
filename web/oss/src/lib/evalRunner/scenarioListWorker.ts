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
        order?: "ascending" | "descending"
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
    order?: "ascending" | "descending"
}

async function fetchPage({
    apiUrl,
    jwt,
    projectId,
    runId,
    next,
    limit,
    order,
}: FetchArgs): Promise<{scenarios: IScenario[]; next?: string}> {
    // POST to query endpoint
    const url = `${apiUrl}/preview/evaluations/scenarios/query?project_id=${encodeURIComponent(projectId)}`
    const body: Record<string, any> = {
        scenario: {
            ...(runId ? {run_ids: [runId]} : {}),
        },
        windowing: {
            limit,
            ...(next ? {next} : {}),
            ...(order ? {order} : {}),
        },
    }

    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${jwt}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`fetch ${res.status}`)
    const json = (await res.json()) as {scenarios?: IScenario[]; next?: string}

    const scenarios = json.scenarios ?? []
    const nextCursor =
        json.next ??
        (scenarios.length === limit ? (scenarios[scenarios.length - 1]?.id ?? null) : null)
    return {scenarios, next: nextCursor}
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
    const {requestId, payload} = e.data
    try {
        const scenarios: IScenario[] = []
        let next: string | null | undefined = null
        let _batch = 0
        do {
            const page = await fetchPage({
                ...payload,
                next,
                limit: PAGE_SIZE,
                order: payload.order,
            })
            scenarios.push(...page.scenarios)
            _batch += 1
            next = page.next ?? null
        } while (next)

        // Deduplicate scenarios by id in case backend returned duplicates
        const seen = new Set<string>()
        const uniqueScenarios = scenarios.filter((s) => {
            if (seen.has(s.id)) return false
            seen.add(s.id)
            return true
        })

        const shouldSortDescending = payload.order === "descending"

        const toNumericValue = (value: unknown): number | null => {
            if (value === null || value === undefined) {
                return null
            }
            if (typeof value === "number") {
                return Number.isFinite(value) ? value : null
            }
            if (typeof value === "string") {
                const parsedDate = Date.parse(value)
                if (!Number.isNaN(parsedDate)) {
                    return parsedDate
                }
                const parsedNumber = Number(value)
                if (!Number.isNaN(parsedNumber)) {
                    return parsedNumber
                }
            }
            return null
        }

        const getScenarioSortValue = (scenario: Record<string, any>): number => {
            const primaryCandidates = [
                scenario?.timestamp,
                scenario?.createdAt,
                scenario?.created_at,
                scenario?.meta?.timestamp,
                scenario?.meta?.createdAt,
                scenario?.meta?.created_at,
                scenario?.meta?.updatedAt,
                scenario?.meta?.updated_at,
            ]

            for (const candidate of primaryCandidates) {
                const numeric = toNumericValue(candidate)
                if (numeric !== null) {
                    return numeric
                }
            }

            const indexCandidates = [
                scenario?.meta?.index,
                scenario?.meta?.order,
                scenario?.meta?.order_index,
                scenario?.index,
            ]

            for (const candidate of indexCandidates) {
                const numeric = toNumericValue(candidate)
                if (numeric !== null) {
                    return numeric
                }
            }

            return Number.MIN_SAFE_INTEGER
        }

        const orderedScenarios = shouldSortDescending
            ? [...uniqueScenarios].sort((a, b) => {
                  const diff = getScenarioSortValue(b) - getScenarioSortValue(a)
                  if (diff !== 0) {
                      return diff
                  }
                  const idA = typeof a?.id === "string" ? a.id : ""
                  const idB = typeof b?.id === "string" ? b.id : ""
                  return idB.localeCompare(idA)
              })
            : uniqueScenarios

        const resp: WorkerResponse = {requestId, ok: true, data: orderedScenarios}
        // @ts-ignore
        self.postMessage(resp)
    } catch (err: any) {
        const resp: WorkerResponse = {requestId, ok: false, error: err.message || "unknown"}
        // @ts-ignore
        self.postMessage(resp)
    }
}
