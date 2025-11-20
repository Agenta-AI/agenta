import {v4 as uuidv4} from "uuid"

import {EvaluationStatus} from "@/oss/lib/Types"
import {BaseResponse} from "@/oss/lib/Types"

/**
 * Update scenario status from a WebWorker / non-axios context.
 */
export async function updateScenarioStatusRemote(
    apiUrl: string,
    jwt: string,
    scenarioId: string,
    status: EvaluationStatus,
    projectId: string,
): Promise<void> {
    try {
        // 1. fetch full scenario (backend requires full object on PATCH)
        const res = await fetch(
            `${apiUrl}/preview/evaluations/scenarios/${scenarioId}?project_id=${projectId}`,
            {
                headers: {Authorization: `Bearer ${jwt}`},
            },
        )
        let scenarioFull: any | null = null
        if (res.ok) {
            const json = (await res.json()) as BaseResponse
            if (json?.scenario) scenarioFull = json.scenario
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
        const query = new URLSearchParams({
            project_id: projectId,
            run_ids: runId,
            scenario_ids: scenarioId,
            key: key,
        })
        const res = await fetch(`${apiUrl}/preview/evaluations/steps/?${query.toString()}`, {
            headers: {Authorization: `Bearer ${jwt}`},
        })
        if (res.ok) {
            const data = await res.json()
            const existing = Array.isArray(data.steps)
                ? data.steps.find((s: any) => s.key === key)
                : undefined
            if (existing) {
                const updated = {
                    ...existing,
                    status,
                    trace_id: traceId,
                    span_id: spanId,
                    references: {...((existing as any)?.references || {}), ...references},
                }
                await fetch(
                    `${apiUrl}/preview/evaluations/steps/${existing.id}?project_id=${projectId}`,
                    {
                        method: "PATCH",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${jwt}`,
                        },
                        body: JSON.stringify({step: updated}),
                    },
                )
                return
            }
        }
    } catch {
        /* fallthrough to creation */
    }

    const body = {
        steps: [
            {
                status,
                key,
                trace_id: traceId,
                span_id: spanId,
                scenario_id: scenarioId,
                run_id: runId,
                references,
            },
        ],
    }
    try {
        await fetch(`${apiUrl}/preview/evaluations/steps/?project_id=${projectId}`, {
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
