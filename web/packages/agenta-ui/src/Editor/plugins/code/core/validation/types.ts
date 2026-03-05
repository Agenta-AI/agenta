export interface ErrorInfo {
    id: string
    message: string
    type: "syntax" | "validation" | "schema" | "bracket" | "structural"
    line?: number
    column?: number
    severity?: "error" | "warning" | "info"
}

export interface ValidationState {
    errors: ErrorInfo[]
    errorsByLine: Map<number, ErrorInfo[]>
    lastValidatedContent: string
    timestamp: number
}

export const EMPTY_VALIDATION_STATE: ValidationState = {
    errors: [],
    errorsByLine: new Map(),
    lastValidatedContent: "",
    timestamp: 0,
}
