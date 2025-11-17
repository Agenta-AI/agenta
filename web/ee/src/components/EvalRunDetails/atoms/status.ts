import {EvaluationStatus} from "@/oss/lib/Types"

const ACTIVE_STATUSES = new Set<string>([
    EvaluationStatus.PENDING,
    EvaluationStatus.INITIALIZED,
    EvaluationStatus.STARTED,
    EvaluationStatus.RUNNING,
])

export const ACTIVE_RUN_REFETCH_INTERVAL = 15_000

export const isActiveEvaluationStatus = (status?: string | null): boolean => {
    if (!status) return false
    return ACTIVE_STATUSES.has(status)
}
