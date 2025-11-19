import {formatMetricValue as formatMetricValueWithKey} from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover/assets/utils"

import {
    formatEvaluatorMetricValue,
    isBasicStats,
    METRIC_PLACEHOLDER,
} from "../../../../../ee/src/lib/runMetrics/formatters"

const EMPTY_PLACEHOLDER = METRIC_PLACEHOLDER

export const formatMetricDisplay = ({
    value,
    metricKey,
    metricType,
}: {
    value: unknown
    metricKey?: string
    metricType?: string
}): string => {
    if (value === null || value === undefined) return EMPTY_PLACEHOLDER

    if (Array.isArray(value)) {
        const formattedItems = value
            .map((item) => formatMetricDisplay({value: item, metricKey, metricType}))
            .filter((item) => item && item !== EMPTY_PLACEHOLDER)
        return formattedItems.length ? formattedItems.join(", ") : EMPTY_PLACEHOLDER
    }

    if (typeof value === "boolean") {
        return String(value)
    }

    if (typeof value === "object" && value !== null) {
        if (isBasicStats(value)) {
            const formatted = formatEvaluatorMetricValue(value, metricKey)
            if (formatted !== EMPTY_PLACEHOLDER) {
                return formatted
            }
        }

        try {
            return JSON.stringify(value)
        } catch {
            return String(value)
        }
    }

    if (typeof value === "number" || typeof value === "string") {
        if (metricType === "boolean") {
            return String(value)
        }
        const formatted = formatMetricValueWithKey(metricKey ?? "", value as number | string)
        return formatted || EMPTY_PLACEHOLDER
    }

    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

export const METRIC_EMPTY_PLACEHOLDER = EMPTY_PLACEHOLDER
