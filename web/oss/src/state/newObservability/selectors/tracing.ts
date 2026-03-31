import dayjs from "dayjs"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {formatCurrency, formatLatency, formatTokenUsage} from "@/oss/lib/helpers/formatters"
import {getStringOrJson} from "@/oss/lib/helpers/utils"
import {TraceSpanNode} from "@/oss/services/tracing/types/index"

// Metric extraction helpers ----------------------------------------------------
const getTokenMetrics = (span?: TraceSpanNode) => span?.attributes?.ag?.metrics?.tokens ?? null

export const getTokens = (span?: TraceSpanNode) => {
    const tokens = getTokenMetrics(span)
    return tokens?.cumulative?.total ?? tokens?.incremental?.total ?? null
}

export const getPromptTokens = (span?: TraceSpanNode) => {
    const tokens = getTokenMetrics(span)
    return tokens?.cumulative?.prompt ?? tokens?.incremental?.prompt ?? null
}

export const getCompletionTokens = (span?: TraceSpanNode) => {
    const tokens = getTokenMetrics(span)
    return tokens?.cumulative?.completion ?? tokens?.incremental?.completion ?? null
}

export const getCost = (span?: TraceSpanNode) => {
    const costs = span?.attributes?.ag?.metrics?.costs
    return costs?.cumulative?.total ?? costs?.incremental?.total ?? null
}

export const getLatency = (span?: TraceSpanNode) =>
    span?.attributes?.ag?.metrics?.duration?.cumulative ?? null

export const getTraceInputs = (span?: TraceSpanNode) => span?.attributes?.ag?.data?.inputs ?? null

export const getTraceOutputs = (span?: TraceSpanNode) => span?.attributes?.ag?.data?.outputs ?? null

// General attribute helpers ----------------------------------------------------
export const getAgMetaConfiguration = (span?: TraceSpanNode) =>
    span?.attributes?.ag?.meta?.configuration ?? null

export const getAgData = (span?: TraceSpanNode) => span?.attributes?.ag?.data ?? null

export const getAgDataInputs = (span?: TraceSpanNode) => getAgData(span)?.inputs ?? null

export const getAgDataOutputs = (span?: TraceSpanNode) => getAgData(span)?.outputs ?? null

export const getAgDataInternals = (span?: TraceSpanNode) => getAgData(span)?.internals ?? null

export const getAgNodeType = (span?: TraceSpanNode) => span?.attributes?.ag?.node?.type ?? null

export const getSpanException = (span?: TraceSpanNode) =>
    span?.events?.find((event) => event.name === "exception") ?? null

// Raw metric selectors ---------------------------------------------------------
export const spanTokensAtomFamily = atomFamily((span?: TraceSpanNode) =>
    atom(() => getTokens(span)),
)

export const spanCostAtomFamily = atomFamily((span?: TraceSpanNode) => atom(() => getCost(span)))

export const spanLatencyAtomFamily = atomFamily((span?: TraceSpanNode) =>
    atom(() => getLatency(span)),
)

export const spanStartTimeAtomFamily = atomFamily((span?: TraceSpanNode) =>
    atom(() => dayjs(span?.start_time).utc().format("DD/MM/YYYY, hh:mm:ss A")),
)

export const spanEndTimeAtomFamily = atomFamily((span?: TraceSpanNode) =>
    atom(() => dayjs(span?.end_time).utc().format("DD/MM/YYYY, hh:mm:ss A")),
)

export const spanTraceInputsAtomFamily = atomFamily((span?: TraceSpanNode) =>
    atom(() => getStringOrJson(getTraceInputs(span))),
)

export const spanTraceOutputsAtomFamily = atomFamily((span?: TraceSpanNode) =>
    atom(() => getStringOrJson(getTraceOutputs(span))),
)

export const spanMetaConfigurationAtomFamily = atomFamily((span?: TraceSpanNode) =>
    atom(() => getAgMetaConfiguration(span)),
)

export const spanAgDataAtomFamily = atomFamily((span?: TraceSpanNode) =>
    atom(() => getAgData(span)),
)

export const spanDataInputsAtomFamily = atomFamily((span?: TraceSpanNode) =>
    atom(() => getAgDataInputs(span)),
)

export const spanDataOutputsAtomFamily = atomFamily((span?: TraceSpanNode) =>
    atom(() => getAgDataOutputs(span)),
)

export const spanDataInternalsAtomFamily = atomFamily((span?: TraceSpanNode) =>
    atom(() => getAgDataInternals(span)),
)

export const spanNodeTypeAtomFamily = atomFamily((span?: TraceSpanNode) =>
    atom(() => getAgNodeType(span)),
)

export const spanExceptionAtomFamily = atomFamily((span?: TraceSpanNode) =>
    atom(() => getSpanException(span)),
)

// Formatted metric selectors ---------------------------------------------------
export const formattedSpanTokensAtomFamily = atomFamily((span?: TraceSpanNode) =>
    atom(() => formatTokenUsage(getTokens(span))),
)

export const formattedSpanPromptTokensAtomFamily = atomFamily((span?: TraceSpanNode) =>
    atom(() => formatTokenUsage(getPromptTokens(span))),
)

export const formattedSpanCompletionTokensAtomFamily = atomFamily((span?: TraceSpanNode) =>
    atom(() => formatTokenUsage(getCompletionTokens(span))),
)

export const formattedSpanCostAtomFamily = atomFamily((span?: TraceSpanNode) =>
    atom(() => formatCurrency(getCost(span))),
)

export const formattedSpanLatencyAtomFamily = atomFamily((span?: TraceSpanNode) =>
    atom(() => {
        const latency = getLatency(span)
        return formatLatency(latency != null ? latency / 1000 : null)
    }),
)
