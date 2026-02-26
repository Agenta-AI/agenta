import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/oss/lib/helpers/formatters"
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

const CSV_FORMULA_PREFIX = /^[=+\-@]/

const sanitizeCsvCell = (value: string): string => {
    const trimmed = value.trimStart()
    if (!trimmed) return value
    return CSV_FORMULA_PREFIX.test(trimmed) ? `'${value}` : value
}

const convertToStringOrJson = (value: unknown): string => {
    if (value === null || value === undefined) return "N/A"
    if (typeof value === "string") return sanitizeCsvCell(value)

    try {
        return sanitizeCsvCell(JSON.stringify(value))
    } catch {
        return sanitizeCsvCell(String(value))
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
        "Trace ID": sanitizeCsvCell(trace.trace_id || "N/A"),
        Name: sanitizeCsvCell(trace.span_name || "N/A"),
        "Span type": sanitizeCsvCell(trace.span_type || "N/A"),
        Inputs: convertToStringOrJson(inputs),
        Outputs: convertToStringOrJson(outputs),
        Duration: sanitizeCsvCell(duration),
        Cost: sanitizeCsvCell(cost),
        Usage: sanitizeCsvCell(usage),
        Timestamp: sanitizeCsvCell(
            formatDay({
                date: trace.start_time,
                inputFormat: "YYYY-MM-DDTHH:mm:ss.SSSSSS",
                outputFormat: "HH:mm:ss DD MMM YYYY",
            }),
        ),
        Status: status,
    }
}
