export type ValidationErrorType =
    | "greater_than_equal"
    | "less_than_equal"
    | "greater_than"
    | "less_than"
    | "type_error"
    | "value_error"
    | string

export interface ValidationError {
    type: ValidationErrorType
    loc: string[]
    msg: string
    input: unknown
    ctx?: Record<string, unknown>
    message?: string
}

export interface ApiError {
    detail: ValidationError | ValidationError[]
}
