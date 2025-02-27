import {
    IGNORED_LOCATION_PARTS,
    VALIDATION_TYPE_CTX_MAP,
    type IgnoredLocationPart,
} from "./constants"
import type {ValidationError} from "./types"

/**
 * Transforms error location array into human-readable path
 * Filters out internal implementation paths and formats remaining parts
 */
export function formatLocation(loc: string[]): string {
    return (
        loc
            .filter(
                (part): part is IgnoredLocationPart =>
                    !IGNORED_LOCATION_PARTS.includes(part as IgnoredLocationPart),
            )
            .map((part) =>
                part
                    .split("_")
                    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(" "),
            )
            .join(" → ") || "Value"
    )
}

/**
 * Generates constraint-based error message based on validation type
 * @returns Formatted message or null if not a constraint error
 */
export function getConstraintMessage(location: string, error: ValidationError): string | null {
    const ctxKey = VALIDATION_TYPE_CTX_MAP[error.type as keyof typeof VALIDATION_TYPE_CTX_MAP]
    if (!ctxKey) return null

    const constraintValue = error.ctx?.[ctxKey]
    const operation = error.type.replace(/_/g, " ")

    return `${location} must be ${operation} ${constraintValue}`
}
