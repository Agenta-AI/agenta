/**
 * Value Extraction Utilities
 *
 * Functions for extracting values from input rows and OpenAPI specs,
 * plus re-exports of strip utilities from @agenta/shared.
 *
 * @packageDocumentation
 */

import {stripAgentaMetadataDeep, stripEnhancedWrappers} from "@agenta/shared/utils"

import {extractAllEndpointSchemas} from "../api"
import type {OpenAPISpec} from "../api"

// Local one-liner — same as parameterConversion.ts's internal toSnakeCaseKey
const toSnakeCase = (str: string): string =>
    str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

export {toSnakeCase}

export {stripAgentaMetadataDeep, stripEnhancedWrappers}

/**
 * Extract input keys from an OpenAPI spec, excluding ag_config and messages.
 */
export const extractInputKeysFromSchema = (spec: OpenAPISpec, routePath = "") => {
    const {primaryEndpoint} = extractAllEndpointSchemas(spec as any, routePath)
    if (!primaryEndpoint?.requestProperties) return []
    return primaryEndpoint.requestProperties.filter(
        (key: string) => !["ag_config", "messages"].includes(key),
    )
}

/**
 * Extract input values from an input row.
 * Unwraps primitive wrappers ({value: X}) and strips metadata fields.
 */
export function extractInputValues(inputRow: Record<string, any>): Record<string, string> {
    return Object.entries(inputRow).reduce(
        (acc, [key, value]) => {
            if (key === "__id" || key === "__metadata" || key === "__result") {
                return acc
            }

            if (value && typeof value === "object" && "value" in value) {
                acc[key] = (value as {value: string}).value
            }
            return acc
        },
        {} as Record<string, string>,
    )
}
