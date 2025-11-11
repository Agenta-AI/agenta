/*
Web Worker: Fetch run-level metrics for a single evaluation run.
Receives a message of form:
  { requestId: string, payload: { apiUrl: string; jwt: string; projectId: string; runId: string } }
Responds with:
  { requestId, ok: true, data: metrics[] }  or  { requestId, ok:false, error }
*/

interface WorkerRequest {
    requestId: string
    payload: {
        apiUrl: string
        jwt: string
        projectId: string
        runId: string
        evaluatorSlugs?: string[]
        revisionSlugs?: string[]
    }
}

interface WorkerResponse {
    requestId: string
    ok: boolean
    data?: any[]
    stats?: Record<string, any>
    error?: string
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
    const {requestId, payload} = e.data
    try {
        const {apiUrl, jwt, projectId, runId, evaluatorSlugs = [], revisionSlugs = []} = payload
        const url = `${apiUrl}/preview/evaluations/metrics/?run_ids=${runId}&project_id=${projectId}`
        const resp = await fetch(url, {
            headers: {Authorization: jwt ? `Bearer ${jwt}` : ""},
        })
        if (!resp.ok) throw new Error(`fetch ${resp.status}`)
        const json = (await resp.json()) as {metrics?: any[]}
        const camel = Array.isArray(json.metrics) ? json.metrics.map((m) => m) : []

        // Utility to extract slug and category from stepKey
        const classifyKey = (
            key: string,
        ): {type: "invocation" | "evaluator" | "revision"; slug?: string} => {
            const parts = key.split(".")
            if (parts.length === 1 && !evaluatorSlugs.includes(parts[0]))
                return {type: "invocation"}
            const slug = parts[1]
            if (evaluatorSlugs.includes(slug)) return {type: "evaluator", slug}
            if (revisionSlugs.includes(slug)) return {type: "revision", slug}
            // default treat as evaluator
            return {type: "evaluator", slug: slug ?? parts[0]}
        }
        const transformData = (data: Record<string, any>): Record<string, any> => {
            const flat: Record<string, any> = {}
            Object.entries(data || {}).forEach(([stepKey, metrics]) => {
                const {type, slug} = classifyKey(stepKey)
                Object.entries(metrics as Record<string, any>).forEach(([metricKey, raw]) => {
                    let value: any = raw
                    if (typeof raw === "object" && raw !== null) {
                        if ("mean" in raw) {
                            value = (raw as any).mean
                        } else if ("value" in raw) {
                            value = (raw as any).value
                        }
                    }
                    // Map invocation-level metrics
                    if (type === "invocation") {
                        let newKey = metricKey
                        if (metricKey.startsWith("tokens.")) {
                            newKey = metricKey.slice(7) + "Tokens" // tokens.prompt -> promptTokens
                        } else if (metricKey.startsWith("cost")) {
                            newKey = "totalCost" // cost or costs.total -> totalCost
                        }
                        flat[newKey] = value
                    } else {
                        const pref = slug ? `${slug}.` : ""
                        flat[`${pref}${metricKey}`] = value
                    }
                })
            })
            return flat
        }

        camel.forEach((entry: any) => {
            // removing the run level metrics from the scenario metrics
            if (!entry?.scenario_id) return
            entry.data = transformData(entry.data || {})
        })

        // Dynamically import to keep worker bundle lean until needed
        const {computeRunMetrics} = await import("@/oss/services/runMetrics/api")
        const stats = computeRunMetrics(camel.map((m: any) => ({data: m.data || {}})))
        const res: WorkerResponse = {requestId, ok: true, data: camel, stats}
        // @ts-ignore
        self.postMessage(res)
    } catch (err: any) {
        const res: WorkerResponse = {requestId, ok: false, error: err.message || "unknown"}
        // @ts-ignore
        self.postMessage(res)
    }
}
