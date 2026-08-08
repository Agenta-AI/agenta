import {
    isSpansResponse,
    isTracesResponse,
    sortSpansByStartTime,
    transformTracesResponseToTree,
    transformTracingResponse,
} from "@agenta/entities/trace"

// The dashboard transform (bucket mapper, tick formatting, bucket sizing) moved to
// @agenta/observability so mobile renders the same usage figures.

// Re-export entity functions for backward compatibility
export {
    isSpansResponse,
    isTracesResponse,
    sortSpansByStartTime,
    transformTracesResponseToTree,
    transformTracingResponse,
}

export const rangeToIntervalMinutes = (range: string): number => {
    switch (range) {
        case "1h":
            return 60
        case "24h":
            return 60
        case "7d":
            return 360
        case "30d":
            return 720
        default:
            return 720
    }
}

export const normalizeDurationSeconds = (d = 0) => d / 1_000
