import {EvaluationStatus} from "@/oss/lib/Types"

/**
 * Update scenario status from a WebWorker / non-axios context.
 */
export async function updateScenarioStatusRemote(
    apiUrl: string,
    jwt: string,
    scenarioId: string,
    status: EvaluationStatus,
    projectId: string,
    runId?: string,
): Promise<void> {
    try {
        // 1. Query results to validate scenario context (scenarios GET is deprecated)
        const res = await fetch(
            `${apiUrl}/preview/evaluations/results/query?project_id=${projectId}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${jwt}`,
                },
                body: JSON.stringify({
                    result: {
                        scenario_ids: [scenarioId],
                        ...(runId ? {run_ids: [runId]} : {}),
                    },
                    windowing: {},
                }),
            },
        )
        let scenarioFull: any | null = null
        if (res.ok) {
            // We no longer rely on the scenario payload; server requires id for PATCH
            // Keep minimal object; if server returns extra data in future, parse here
            scenarioFull = {id: scenarioId}
        }
        if (!scenarioFull) scenarioFull = {id: scenarioId}
        scenarioFull.status = status
        await fetch(`${apiUrl}/preview/evaluations/scenarios/?project_id=${projectId}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${jwt}`,
            },
            body: JSON.stringify({scenarios: [scenarioFull]}),
        })
    } catch {
        /* swallow */
    }
}

/**
 * Upsert (create or update) a generic scenario step. Can be used for invocation or annotation steps.
 */
export async function upsertScenarioStep(params: {
    apiUrl: string
    jwt: string
    runId: string
    scenarioId: string
    status: EvaluationStatus
    projectId: string
    key: string
    traceId?: string | null
    spanId?: string | null
    references?: Record<string, any>
}): Promise<void> {
    const {
        apiUrl,
        jwt,
        runId,
        scenarioId,
        status,
        projectId,
        key,
        traceId,
        spanId,
        references = {},
    } = params
    try {
        const res = await fetch(
            `${apiUrl}/preview/evaluations/results/query?project_id=${projectId}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${jwt}`,
                },
                body: JSON.stringify({
                    result: {
                        run_ids: [runId],
                        scenario_ids: [scenarioId],
                        step_keys: [key],
                    },
                    windowing: {},
                }),
            },
        )
        if (res.ok) {
            const data = await res.json()
            const list = Array.isArray(data.results)
                ? data.results
                : Array.isArray(data.steps)
                  ? data.steps
                  : []
            const existing = list.find((s: any) => s.step_key === key || s.stepKey === key)
            if (existing) {
                const updated = {
                    ...existing,
                    status,
                    trace_id: traceId,
                    span_id: spanId,
                    references: {...((existing as any)?.references || {}), ...references},
                }
                await fetch(`${apiUrl}/preview/evaluations/results/?project_id=${projectId}`, {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${jwt}`,
                    },
                    // API expects bulk-style body: { results: [ { id, ...fields } ] }
                    body: JSON.stringify({results: [updated]}),
                })
                return
            }
        }
    } catch {
        /* fallthrough to creation */
    }

    const body = {
        results: [
            {
                status,
                step_key: key,
                trace_id: traceId,
                span_id: spanId,
                scenario_id: scenarioId,
                run_id: runId,
                references,
            },
        ],
    }
    try {
        await fetch(`${apiUrl}/preview/evaluations/results/?project_id=${projectId}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${jwt}`,
            },
            body: JSON.stringify(body),
        })
    } catch {
        /* ignore */
    }
}
