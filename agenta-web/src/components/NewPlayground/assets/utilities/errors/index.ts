import {formatLocation, getConstraintMessage} from "./utils"
import type {ValidationError, ApiError} from "./types"

/**
 * Processes individual validation errors into human-readable messages
 * Handles different error types with specialized formatting:
 * - Constraint violations (gt, lt, ge, le)
 * - Type errors
 * - Generic value errors
 */
function formatSingleError(error: ValidationError): string {
    if (error.loc) {
        const location = formatLocation(error.loc)

        // Try constraint-based message first
        const constraintMessage = getConstraintMessage(location, error)
        if (constraintMessage) return constraintMessage

        // Handle other error types
        switch (error.type) {
            case "type_error":
                return `${location} must be a valid ${error.ctx?.expected_type}`
            case "value_error":
                return `Invalid value for ${location}: ${error.msg}`
            default:
                return `${location}: ${error.msg}`
        }
    } else {
        return error.message
    }
}

/**
 * Entry point for API error parsing
 * Handles both single and multiple validation errors
 * Provides fallback error messages for unexpected error structures
 */
export function parseValidationError(error: unknown): string {
    try {
        if (!error || typeof error !== "object") {
            return "An unknown error occurred"
        }

        const apiError = error as ApiError
        if ("detail" in apiError) {
            return Array.isArray(apiError.detail)
                ? apiError.detail.map(formatSingleError).join("\n")
                : formatSingleError(apiError.detail)
        }

        if ("type" in error && "loc" in error) {
            try {
                return formatSingleError(error as ValidationError)
            } catch {
                return error.message
            }
        }

        return "An unexpected error occurred"
    } catch (e) {
        console.error("Error parsing validation error:", e)
        return "Failed to process error message"
    }
}
