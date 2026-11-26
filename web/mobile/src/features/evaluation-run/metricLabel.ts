import {humanizeMetricLabel} from "@agenta/entities/evaluationRun"

const words = (text: string) =>
    text.replace(/[-_.]/g, " ").replace(/\s+/g, " ").trim().toLowerCase()

/** A metric's label without its evaluator's name in front, e.g. "quality-rating.approved" -> "Approved". */
export const metricDisplayLabel = (raw: string, evaluatorName?: string | null): string => {
    const label = humanizeMetricLabel(raw)
    const prefix = evaluatorName ? words(evaluatorName) : ""
    if (!prefix || !label.toLowerCase().startsWith(`${prefix} `)) return label
    const rest = label.slice(prefix.length + 1)
    return rest.charAt(0).toUpperCase() + rest.slice(1)
}
