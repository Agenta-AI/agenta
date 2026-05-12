import {formatCurrency, formatLatency, formatTokenUsage} from "@agenta/shared/utils"

import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {TraceSpan, TraceSpanNode} from "@/oss/services/tracing/types"
import {
    getAgDataInputs,
    getAgDataOutputs,
    getCost,
    getLatency,
    getTokens,
} from "@/oss/state/newObservability/selectors/tracing"

export const DEFAULT_TRACE_EXPORT_HEADERS = [
    "Trace ID",
    "Name",
    "Span type",
    "Inputs",
    "Outputs",
    "Duration",
    "Cost",
    "Usage",
    "Timestamp",
    "Status",
]

const convertToStringOrJson = (value: unknown): string => {
    if (value === null || value === undefined) return "N/A"
    if (typeof value === "string") return value

    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

export const createTraceObject = (trace: TraceSpanNode | TraceSpan) => {
    const inputs = getAgDataInputs(trace)
    const outputs = getAgDataOutputs(trace)
    const duration = formatLatency(getLatency(trace))
    const cost = formatCurrency(getCost(trace))
    const usage = formatTokenUsage(getTokens(trace))

    const normalizedStatus = `${trace.status_code || ""}`.toLowerCase()
    const status =
        normalizedStatus === "status_code_error" || normalizedStatus === "failed"
            ? "ERROR"
            : normalizedStatus === "status_code_ok" || normalizedStatus === "success"
              ? "SUCCESS"
              : "UNKNOWN"

    return {
        "Trace ID": trace.trace_id || "N/A",
        Name: trace.span_name || "N/A",
        "Span type": trace.span_type || "N/A",
        Inputs: convertToStringOrJson(inputs),
        Outputs: convertToStringOrJson(outputs),
        Duration: duration,
        Cost: cost,
        Usage: usage,
        Timestamp: formatDay({
            date: trace.start_time,
            inputFormat: "YYYY-MM-DDTHH:mm:ss.SSSSSS",
            outputFormat: "HH:mm:ss DD MMM YYYY",
        }),
        Status: status,
    }
}
