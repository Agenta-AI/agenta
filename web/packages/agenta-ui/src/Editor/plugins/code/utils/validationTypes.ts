/**
 * Enhanced validation types for multi-layer validation system
 */

export type ValidationLevel = "structural" | "syntax" | "schema"
export type ValidationSeverity = "error" | "warning"

export interface BaseValidationError {
    level: ValidationLevel
    severity: ValidationSeverity
    message: string
    token?: string
    line?: number
    column?: number
    timestamp: number
}

export interface StructuralError extends BaseValidationError {
    level: "structural"
    type:
        | "unclosed_bracket"
        | "unclosed_quote"
        | "unclosed_array"
        | "unclosed_object"
        | "invalid_structure"
    openingChar?: string
    expectedClosing?: string
    openingLine?: number
    openingColumn?: number
}

export interface SyntaxError extends BaseValidationError {
    level: "syntax"
    type: "unquoted_property" | "invalid_value" | "trailing_comma" | "invalid_json" | "invalid_yaml"
    suggestion?: string
}

export interface SchemaError extends BaseValidationError {
    level: "schema"
    type: "required_property" | "additional_property" | "type_mismatch" | "enum_violation"
    schemaPath?: string
    instancePath?: string
    params?: Record<string, any>
}

export type ValidationError = StructuralError | SyntaxError | SchemaError

export interface BracketInfo {
    type: "[" | "{" | "("
    line: number
    column: number
    lineKey: string
}

export interface QuoteInfo {
    type: '"' | "'"
    line: number
    column: number
    lineKey: string
}

export interface MultiLineTracker {
    openBrackets: BracketInfo[]
    openQuotes: QuoteInfo[]

    addBracket(bracket: BracketInfo): void
    removeBracket(type: "]" | "}" | ")"): BracketInfo | null
    addQuote(quote: QuoteInfo): void
    removeQuote(type: '"' | "'"): QuoteInfo | null
    getStructuralErrors(): StructuralError[]
    clear(): void
}

export interface EnhancedValidationContext {
    // Error storage by validation level
    structuralErrors: Map<string, StructuralError[]>
    syntaxErrors: Map<string, SyntaxError[]>
    schemaErrors: Map<string, SchemaError[]>

    // Multi-line structure tracking
    multiLineTracker: MultiLineTracker

    // Combined error state for highlighting
    errorTexts: Set<string>
    errorList: ValidationError[]

    // Performance tracking
    lastStructuralValidation: number
    lastSyntaxValidation: number
    lastSchemaValidation: number

    // Utility methods
    getErrorsForToken(token: string): ValidationError[]
    addError(error: ValidationError): void
    removeErrorsForToken(token: string, level?: ValidationLevel): void
    clearErrors(level?: ValidationLevel): void
    updateErrorTexts(): void
}
