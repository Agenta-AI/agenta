import axios from "@/oss/lib/api/assets/axiosConfig"
import createBatchFetcher from "@/oss/state/utils/createBatchFetcher"

interface PreviewRunBatchKey {
    projectId: string
    runId: string
}

export type PreviewRunBatchValue = any | null

const resolveRunId = (run: any): string | null => {
    if (!run || typeof run !== "object") return null
    return (
        run.id ?? run._id ?? run.run_id ?? run?.run?.id ?? run?.run?._id ?? run?.run?.run_id ?? null
    )
}

const previewRunCache = new Map<string, PreviewRunBatchValue>()

export const primePreviewRunCache = (projectId: string, runs: any[] | undefined | null) => {
    if (!projectId || !Array.isArray(runs)) return
    runs.forEach((run) => {
        const runId = resolveRunId(run)
        if (!runId) return
        const key = `${projectId}:${runId}`
        const payload = run?.run ?? run ?? null
        previewRunCache.set(key, payload)
    })
}

let previewRunBatcherCore:
    | ((key: PreviewRunBatchKey) => Promise<PreviewRunBatchValue | undefined>)
    | null = null

const getPreviewRunBatcherCore = () => {
    if (!previewRunBatcherCore) {
        previewRunBatcherCore = createBatchFetcher<PreviewRunBatchKey, PreviewRunBatchValue>({
            serializeKey: ({projectId, runId}) => `${projectId}:${runId}`,
            batchFn: async (keys, serializedKeys) => {
                const runsByProject = new Map<string, Set<string>>()
                const responseMap = new Map<string, PreviewRunBatchValue>()

                serializedKeys.forEach((serializedKey, index) => {
                    responseMap.set(serializedKey, previewRunCache.get(serializedKey) ?? null)
                    const {projectId, runId} = keys[index]
                    if (!projectId || !runId) {
                        return
                    }
                    if (previewRunCache.has(serializedKey)) {
                        return
                    }
                    if (!runsByProject.has(projectId)) {
                        runsByProject.set(projectId, new Set())
                    }
                    runsByProject.get(projectId)?.add(runId)
                })

                await Promise.all(
                    Array.from(runsByProject.entries()).map(async ([projectId, runIds]) => {
                        if (!runIds.size) return

                        const payload = {
                            run: {
                                ids: Array.from(runIds),
                            },
                        }

                        const response = await axios.post(
                            `/preview/evaluations/runs/query`,
                            payload,
                            {
                                params: {project_id: projectId},
                            },
                        )

                        const runs = Array.isArray(response?.data?.runs) ? response.data.runs : []

                        runs.forEach((run: any) => {
                            const runId = resolveRunId(run)
                            if (!runId) return
                            const key = `${projectId}:${runId}`
                            const payloadRun = run?.run ?? run ?? null
                            previewRunCache.set(key, payloadRun)
                            responseMap.set(key, payloadRun)
                        })

                        runIds.forEach((runId) => {
                            const key = `${projectId}:${runId}`
                            if (!responseMap.has(key)) {
                                previewRunCache.set(key, null)
                                responseMap.set(key, null)
                            }
                        })
                    }),
                )

                return responseMap
            },
        })
    }

    return previewRunBatcherCore
}

export const getPreviewRunBatcher = () => {
    const core = getPreviewRunBatcherCore()
    return async ({projectId, runId}: PreviewRunBatchKey): Promise<PreviewRunBatchValue> => {
        const key = `${projectId}:${runId}`
        if (previewRunCache.has(key)) {
            return previewRunCache.get(key) ?? null
        }

        const value = await core({projectId, runId})
        const normalized = value ?? null
        previewRunCache.set(key, normalized)
        return normalized
    }
}

export type {PreviewRunBatchKey}
