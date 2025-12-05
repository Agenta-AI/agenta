import axios from "@/oss/lib/api/assets/axiosConfig"

import type {EvaluationRunTableRow} from "../types"

export const deriveAppIds = (
    explicitAppId: string | null | undefined,
    scopedAppId: string | null,
    availableAppIds: string[],
) => {
    if (explicitAppId) return [explicitAppId]
    if (scopedAppId) return [scopedAppId]
    return availableAppIds
}

export const resolveRowAppId = (
    record: EvaluationRunTableRow,
    fallbackAppId: string | null,
): string | null => {
    const directAppId =
        typeof record.appId === "string" && record.appId.trim().length > 0 ? record.appId : null
    if (directAppId) return directAppId

    return fallbackAppId
}

export const deletePreviewRuns = async (projectId: string | null | undefined, runIds: string[]) => {
    if (!projectId || runIds.length === 0) return
    await axios.delete(`/preview/evaluations/runs/`, {
        params: {project_id: projectId},
        data: {run_ids: runIds},
    })
}
