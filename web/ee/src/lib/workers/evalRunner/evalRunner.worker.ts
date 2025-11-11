// evalRunner.worker.ts

import {snakeToCamelCaseKeys} from "@agenta/oss/src/lib/helpers/casing"
import {BaseResponse, EvaluationStatus} from "@agenta/oss/src/lib/Types"

import {
    updateScenarioStatusRemote,
    upsertScenarioStep,
} from "@/oss/services/evaluations/workerUtils"
import {createScenarioMetrics, computeRunMetrics} from "@/oss/services/runMetrics/api"

import {RunEvalMessage, ResultMessage, WorkerMessage} from "./types"

async function updateScenarioStatus(
    apiUrl: string,
    jwt: string,
    scenarioId: string,
    status: EvaluationStatus,
    projectId: string,
) {
    await updateScenarioStatusRemote(apiUrl, jwt, scenarioId, status, projectId)
}

const queue: RunEvalMessage[] = []
let isProcessing = false
let MAX_CONCURRENT = 5
let activeRequests = 0

// eslint-disable-next-line @typescript-eslint/no-unused-vars
let jwt: string | null = null

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const msg = event.data
    switch (msg.type) {
        case "UPDATE_JWT":
            jwt = msg.jwt
            break
        case "run-invocation":
            if (msg.jwt) jwt = msg.jwt
            queue.push(msg)
            if (!isProcessing) processQueue()
            break
        case "config":
            MAX_CONCURRENT = msg.maxConcurrent
            if (!isProcessing && queue.length > 0) processQueue()
            break
    }
}

async function handleRequest(message: RunEvalMessage) {
    const {
        jwt,
        invocationStepTarget,
        scenarioId,
        projectId,
        runId,
        appId,
        requestBody,
        invocationKey,
        endpoint,
        apiUrl,
    } = message
    try {
        await updateScenarioStatus(apiUrl, jwt, scenarioId, EvaluationStatus.RUNNING, projectId)
        const response = await fetch(`${endpoint}?application_id=${appId}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "ngrok-skip-browser-warning": "1",
                Authorization: `Bearer ${jwt}`,
            },
            body: JSON.stringify(requestBody),
        })

        const _result = (await response.json()) as BaseResponse
        const result = snakeToCamelCaseKeys<BaseResponse>(_result)

        const message: ResultMessage = {
            type: "result",
            scenarioId,
            status: response.status === 200 ? EvaluationStatus.SUCCESS : EvaluationStatus.FAILURE,
            invocationStepTarget,
            invocationKey,
            result: {
                ...result,
                requestBody,
                endpoint,
            },
            // @ts-ignore
            error: response.status !== 200 ? result.detail.message : null,
        }

        const tryCreateScenarioInvocationMetrics = async (result: any, error?: string | null) => {
            const statsMap: Record<string, any> = {}

            // 1. Flatten numeric leaves into dot-notation keys
            const flattenNumeric = (obj: any, prefix = "", out: Record<string, number> = {}) => {
                if (!obj || typeof obj !== "object") return out
                Object.entries(obj).forEach(([k, v]) => {
                    const path = prefix ? `${prefix}.${k}` : k
                    if (typeof v === "number") {
                        out[path] = v
                    } else if (v && typeof v === "object") {
                        flattenNumeric(v, path, out)
                    }
                })
                return out
            }

            if (error) {
                const metricsAcc = result?.detail?.tree?.nodes?.[0]?.metrics?.acc
                const flatMetrics = flattenNumeric({
                    ...(metricsAcc || {}),
                    errors: 1,
                })
                if (!Object.keys(flatMetrics).length) return

                // 2. Compute statistics for each metric
                const statsMapRaw = computeRunMetrics([{data: flatMetrics}])
                // 3. If only one value, keep the mean instead of full stats object
                Object.entries(statsMapRaw).forEach(([k, v]) => {
                    const stats = structuredClone(v)
                    if ("distribution" in stats) delete stats.distribution
                    if ("iqrs" in stats) delete stats.iqrs
                    if ("percentiles" in stats) delete stats.percentiles
                    if ("binSize" in stats) delete stats.binSize
                    statsMap[k] = stats
                })
            } else {
                const metricsAcc = result?.tree?.nodes?.[0]?.metrics?.acc
                if (!metricsAcc) return

                const flatMetrics = flattenNumeric(metricsAcc)
                if (!Object.keys(flatMetrics).length) return

                // 2. Compute statistics for each metric
                const statsMapRaw = computeRunMetrics([{data: flatMetrics}])

                // 3. If only one value, keep the mean instead of full stats object
                Object.entries(statsMapRaw).forEach(([k, v]) => {
                    const stats = structuredClone(v)
                    if ("distribution" in stats) delete stats.distribution
                    if ("iqrs" in stats) delete stats.iqrs
                    if ("percentiles" in stats) delete stats.percentiles
                    if ("binSize" in stats) delete stats.binSize
                    statsMap[k] = stats
                })
            }

            const stepKey = invocationKey ?? "invocation"
            const nestedData = {[stepKey]: statsMap}

            try {
                await createScenarioMetrics(
                    apiUrl,
                    jwt,
                    runId,
                    [{scenarioId, data: nestedData}],
                    projectId,
                )
            } catch (err) {
                console.error("INVOCATION METRICS FAILED:", err)
            }
        }

        if (response.status === 200) {
            tryCreateScenarioInvocationMetrics(result)
            try {
                await upsertScenarioStep({
                    apiUrl,
                    jwt,
                    runId,
                    scenarioId,
                    status: EvaluationStatus.SUCCESS,
                    projectId,
                    key: invocationKey ?? "invocation",
                    traceId: (result as any)?.traceId ?? null,
                    spanId: (result as any)?.spanId ?? null,
                    references: {application: {id: appId}},
                })
                message.result.trace = result?.tree
            } catch (err) {}

            postMessage(message)
        } else {
            tryCreateScenarioInvocationMetrics(result, _result?.detail?.message || _result)
            updateScenarioStatus(apiUrl, jwt, scenarioId, EvaluationStatus.FAILURE, projectId)
            const traceId = result?.detail?.traceId
            const spanId = result?.detail?.spanId

            await upsertScenarioStep({
                apiUrl,
                jwt,
                runId,
                scenarioId,
                status: EvaluationStatus.FAILURE,
                projectId,
                key: invocationKey ?? "invocation",
                traceId,
                spanId,
                references: {application: {id: appId}},
            })

            postMessage(message)
        }
    } catch (err: any) {
        await upsertScenarioStep({
            apiUrl,
            jwt,
            runId,
            scenarioId,
            status: EvaluationStatus.FAILURE,
            projectId,
            key: invocationKey ?? "invocation",
            references: {application: {id: appId}},
        })
        const message: ResultMessage = {
            type: "result",
            scenarioId,
            status: EvaluationStatus.FAILURE,
            error: err.message ?? "Unknown error",
            result: {
                requestBody,
                endpoint,
            },
            invocationStepTarget,
            invocationKey,
            endpoint,
            appId,
        }
        await updateScenarioStatus(apiUrl, jwt, scenarioId, EvaluationStatus.FAILURE, projectId)

        postMessage(message)
    }
}

async function processQueue() {
    isProcessing = true

    while (queue.length > 0 || activeRequests > 0) {
        while (activeRequests < MAX_CONCURRENT && queue.length > 0) {
            const message = queue.shift()!
            activeRequests++
            handleRequest(message).finally(() => {
                activeRequests--
                if (!isProcessing && queue.length > 0) {
                    processQueue()
                }
            })
        }
        // Wait a short time to yield control and allow activeRequests to update
        await new Promise((resolve) => setTimeout(resolve, 10))
    }

    isProcessing = false
}
