/**
 * Playground Snapshot Codec
 *
 * Provides encoding and decoding utilities for playground snapshots.
 * Uses LZ-String for URL-safe compression.
 *
 * @example
 * ```typescript
 * import {
 *     encodeSnapshot,
 *     decodeSnapshot,
 *     parseSnapshot,
 *     MAX_ENCODED_LENGTH,
 * } from '@agenta/playground/snapshot'
 *
 * // Encode a snapshot for URL
 * const result = encodeSnapshot(snapshot)
 * if (result.ok) {
 *     const url = `${baseUrl}#pgSnapshot=${result.encoded}`
 * }
 *
 * // Decode from URL
 * const parseResult = parseSnapshot(encodedString)
 * if (parseResult.ok) {
 *     // Use parseResult.value
 * }
 * ```
 */

import {compressToEncodedURIComponent, decompressFromEncodedURIComponent} from "lz-string"

import {validateSnapshot, type PlaygroundSnapshot, type ValidationResult} from "./snapshotSchema"

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Maximum allowed length for encoded snapshot strings.
 * URLs have practical limits around 2000-8000 characters depending on browser.
 * We use 8KB as a safe limit for the encoded payload.
 */
export const MAX_ENCODED_LENGTH = 8 * 1024 // 8KB

/**
 * Warning threshold for encoded length.
 * Show a warning to users when approaching the limit.
 */
export const WARN_ENCODED_LENGTH = 6 * 1024 // 6KB

// ============================================================================
// ENCODING
// ============================================================================

/**
 * Result of encoding a snapshot.
 */
export interface EncodeResult {
    ok: boolean
    encoded?: string
    error?: string
    /** True if the encoded length exceeds the warning threshold */
    warning?: boolean
    /** The encoded length in bytes */
    length?: number
}

/**
 * Encode a snapshot to a URL-safe string.
 *
 * Uses LZ-String compression for efficient encoding.
 *
 * @param snapshot - The snapshot to encode
 * @returns EncodeResult with the encoded string or an error
 */
export function encodeSnapshot(snapshot: PlaygroundSnapshot): EncodeResult {
    try {
        // Serialize to JSON
        const json = JSON.stringify(snapshot)

        // Compress using LZ-String (URL-safe encoding)
        const encoded = compressToEncodedURIComponent(json)

        if (!encoded) {
            return {ok: false, error: "Compression failed"}
        }

        const length = encoded.length

        // Check length limits
        if (length > MAX_ENCODED_LENGTH) {
            return {
                ok: false,
                error: `Encoded snapshot too large (${length} bytes, max ${MAX_ENCODED_LENGTH})`,
                length,
            }
        }

        return {
            ok: true,
            encoded,
            warning: length > WARN_ENCODED_LENGTH,
            length,
        }
    } catch (err) {
        return {
            ok: false,
            error: `Encoding failed: ${err instanceof Error ? err.message : String(err)}`,
        }
    }
}

// ============================================================================
// DECODING
// ============================================================================

/**
 * Result of decoding a snapshot.
 */
export interface DecodeResult {
    ok: boolean
    data?: unknown
    error?: string
}

/**
 * Decode a URL-safe string to raw data (without validation).
 *
 * @param encoded - The encoded string to decode
 * @returns DecodeResult with the decoded data or an error
 */
export function decodeSnapshot(encoded: string): DecodeResult {
    try {
        if (!encoded || typeof encoded !== "string") {
            return {ok: false, error: "Invalid encoded string"}
        }

        // Decompress using LZ-String
        const json = decompressFromEncodedURIComponent(encoded)

        if (!json) {
            return {ok: false, error: "Decompression failed"}
        }

        // Parse JSON
        const data = JSON.parse(json)

        return {ok: true, data}
    } catch (err) {
        return {
            ok: false,
            error: `Decoding failed: ${err instanceof Error ? err.message : String(err)}`,
        }
    }
}

// ============================================================================
// COMBINED PARSE
// ============================================================================

/**
 * Parse and validate an encoded snapshot string.
 *
 * This is the main entry point for decoding snapshots from URLs.
 * It handles both decompression and validation.
 *
 * @param encoded - The encoded string from the URL
 * @returns ValidationResult with the validated snapshot or an error
 */
export function parseSnapshot(encoded: string): ValidationResult<PlaygroundSnapshot> {
    // Decode
    const decodeResult = decodeSnapshot(encoded)
    if (!decodeResult.ok) {
        return {ok: false, error: decodeResult.error}
    }

    // Validate
    return validateSnapshot(decodeResult.data)
}

/**
 * Check if an encoded string is within safe limits.
 *
 * @param encoded - The encoded string to check
 * @returns Object with size info and warnings
 */
export function checkEncodedSize(encoded: string): {
    length: number
    isValid: boolean
    isWarning: boolean
    percentUsed: number
} {
    const length = encoded.length
    return {
        length,
        isValid: length <= MAX_ENCODED_LENGTH,
        isWarning: length > WARN_ENCODED_LENGTH,
        percentUsed: Math.round((length / MAX_ENCODED_LENGTH) * 100),
    }
}
