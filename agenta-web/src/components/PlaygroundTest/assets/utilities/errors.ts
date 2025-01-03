interface ValidationError {
    type: string
    loc: string[]
    msg: string
    input: any
    ctx?: Record<string, any>
}

interface ApiError {
    detail: ValidationError | ValidationError[]
}

function formatLocation(loc: string[]): string {
    return (
        loc
            .filter((part) => !["body", "agenta_config", "prompt"].includes(part))
            .map((part) =>
                part
                    .split("_")
                    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(" "),
            )
            .join(" → ") || "Value"
    )
}

function formatSingleError(error: ValidationError): string {
    const location = formatLocation(error.loc)

    // Map validation types to their corresponding ctx keys
    const ctxKeyMap = {
        greater_than_equal: "ge",
        less_than_equal: "le",
        greater_than: "gt",
        less_than: "lt",
    } as const

    // Get the constraint value from ctx using the appropriate key
    const constraintValue = error.ctx?.[ctxKeyMap[error.type as keyof typeof ctxKeyMap]]

    switch (error.type) {
        case "greater_than_equal":
            return `${location} must be greater than or equal to ${constraintValue}`
        case "less_than_equal":
            return `${location} must be less than or equal to ${constraintValue}`
        case "greater_than":
            return `${location} must be greater than ${constraintValue}`
        case "less_than":
            return `${location} must be less than ${constraintValue}`
        case "type_error":
            return `${location} must be a valid ${error.ctx?.expected_type}`
        case "value_error":
            return `Invalid value for ${location}: ${error.msg}`
        default:
            return `${location}: ${error.msg}`
    }
}

export function parseValidationError(error: unknown): string {
    try {
        // Handle null/undefined
        if (!error || typeof error !== "object") {
            return "An unknown error occurred"
        }

        // Handle API error structure
        const apiError = error as ApiError
        if ("detail" in apiError) {
            const detail = apiError.detail
            if (Array.isArray(detail)) {
                return detail.map(formatSingleError).join("\n")
            }
            return formatSingleError(detail)
        }

        // Fallback for direct validation error
        if ("type" in error && "loc" in error) {
            return formatSingleError(error as ValidationError)
        }

        return "An unexpected error occurred"
    } catch (e) {
        console.error("Error parsing validation error:", e)
        return "Failed to process error message"
    }
}
