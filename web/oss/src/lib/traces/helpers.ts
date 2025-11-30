import {UUID} from "uuidjs"

/**
 * Parses the UUID and returns the trace ID as a hexadecimal string without delimiters.
 */
export const uuidToTraceId = (uuid?: string) => {
    if (!uuid) return undefined
    const parsed = UUID.parse(uuid)
    return parsed?.hexNoDelim
}

/**
 * Parses the UUID and returns the span ID by combining the clock sequence and node fields.
 */
export const uuidToSpanId = (uuid?: string) => {
    if (!uuid) return undefined
    const parsed = UUID.parse(uuid)
    return `${parsed?.hexFields.clockSeqHiAndReserved}${parsed?.hexFields.clockSeqLow}${parsed?.hexFields.node}`
}
