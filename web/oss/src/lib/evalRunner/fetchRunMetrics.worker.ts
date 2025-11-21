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
        annotationSlugMap?: Record<string, string>
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
        const {
            apiUrl,
            jwt,
            projectId,
            runId,
            evaluatorSlugs = [],
            revisionSlugs = [],
            annotationSlugMap = {},
        } = payload
        const url = `${apiUrl}/preview/evaluations/metrics/query?project_id=${projectId}`
        const body: Record<string, any> = {
            metrics: {run_ids: [runId], scenario_ids: true},
            windowing: {},
        }
        const resp = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: jwt ? `Bearer ${jwt}` : "",
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        })
        if (!resp.ok) throw new Error(`fetch ${resp.status}`)
        const json = (await resp.json()) as {metrics?: any[]}
        const camel = Array.isArray(json.metrics) ? json.metrics.map((m) => m) : []

        try {
            const scenarioBody = {
                ...body,
                metrics: {...body.metrics, scenario_ids: false},
            }
            const scenarioResp = await fetch(url, {
                method: "POST",
                headers: {
                    Authorization: jwt ? `Bearer ${jwt}` : "",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(scenarioBody),
            })
            if (scenarioResp.ok) {
                const scenarioJson = (await scenarioResp.json()) as {metrics?: any[]}
                const scenarioMetrics = Array.isArray(scenarioJson.metrics)
                    ? scenarioJson.metrics.filter((metric) =>
                          Boolean(metric?.scenario_id || metric?.scenarioId),
                      )
                    : []
                camel.push(...scenarioMetrics)
            }
        } catch (scenarioError) {
            console.warn("[fetchRunMetrics.worker] Failed to fetch scenario metrics", scenarioError)
        }

        // Utility to extract slug and category from stepKey
        const classifyKey = (
            key: string,
        ): {type: "invocation" | "evaluator" | "revision"; slug?: string} => {
            const mappedSlug = annotationSlugMap[key]
            if (mappedSlug) {
                return {type: "evaluator", slug: mappedSlug}
            }

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
                // // Pass-through for analytics keys like ag.metrics.*
                // if (stepKey.startsWith("ag.")) {
                //     const raw = metrics
                //     let value: any = raw
                //     if (typeof raw === "object" && raw !== null) {
                //         if ("mean" in raw) value = (raw as any).mean
                //         else if ("value" in raw) value = (raw as any).value
                //     }
                //     flat[stepKey] = value
                //     return
                // }

                const {type, slug} = classifyKey(stepKey)
                Object.entries(metrics as Record<string, any>).forEach(([metricKey, raw]) => {
                    let value: any = structuredClone(raw)
                    if (typeof raw === "object" && raw !== null) {
                        if ("mean" in raw) {
                            value = (raw as any).mean
                        } else if ("freq" in raw) {
                            value.frequency = raw.freq
                            // value.rank = raw.freq
                            value.unique = raw.uniq

                            delete value.freq
                            delete value.uniq
                        } else if ("value" in raw) {
                            value = (raw as any).value
                        }
                    }
                    if (stepKey.startsWith("attributes.ag.")) {
                        const normalizedKey = `${stepKey}.${metricKey}`
                        flat[normalizedKey] = value
                        return
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
            if (!entry?.scenario_id) {
                // Object.entries(entry.data || {}).forEach(([stepKey, metrics]) => {
                //     const {type, slug} = classifyKey(stepKey)
                //     Object.entries(metrics as Record<string, any>).forEach(([metricKey, raw]) => {
                //         let value: any = raw
                //         if (typeof raw === "object" && raw !== null) {
                //             if ("freq" in raw) {
                //                 value.frequency = raw.freq
                //                 value.rank = raw.freq
                //                 delete value.freq
                //                 entry.data[`${slug}.${metricKey}`] = value
                //             }
                //         }
                //     })
                // })
                return
            }
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
