/**
 * Enhanced validation context implementation
 */

import {MultiLineTrackerImpl} from "./multiLineTracker"
import {
    EnhancedValidationContext,
    ValidationError,
    ValidationLevel,
    StructuralError,
    SyntaxError,
    SchemaError,
} from "./validationTypes"

export class EnhancedValidationContextImpl implements EnhancedValidationContext {
    public structuralErrors = new Map<string, StructuralError[]>()
    public syntaxErrors = new Map<string, SyntaxError[]>()
    public schemaErrors = new Map<string, SchemaError[]>()
    public multiLineTracker = new MultiLineTrackerImpl()
    public errorTexts = new Set<string>()
    public errorList: ValidationError[] = []

    public lastStructuralValidation = 0
    public lastSyntaxValidation = 0
    public lastSchemaValidation = 0

    getErrorsForToken(token: string): ValidationError[] {
        const errors: ValidationError[] = []

        // Priority 1: Structural errors (highest priority)
        const structural = this.structuralErrors.get(token)
        if (structural && structural.length > 0) {
            errors.push(...structural)
        }

        // Priority 2: Syntax errors (medium priority)
        const syntax = this.syntaxErrors.get(token)
        if (syntax && syntax.length > 0) {
            errors.push(...syntax)
        }

        // Priority 3: Schema errors (lowest priority)
        const schema = this.schemaErrors.get(token)
        if (schema && schema.length > 0) {
            errors.push(...schema)
        }

        return errors
    }

    addError(error: ValidationError): void {
        const token = error.token || ""

        switch (error.level) {
            case "structural":
                if (!this.structuralErrors.has(token)) {
                    this.structuralErrors.set(token, [])
                }
                this.structuralErrors.get(token)!.push(error as StructuralError)
                this.lastStructuralValidation = Date.now()
                break

            case "syntax":
                if (!this.syntaxErrors.has(token)) {
                    this.syntaxErrors.set(token, [])
                }
                this.syntaxErrors.get(token)!.push(error as SyntaxError)
                this.lastSyntaxValidation = Date.now()
                break

            case "schema":
                if (!this.schemaErrors.has(token)) {
                    this.schemaErrors.set(token, [])
                }
                this.schemaErrors.get(token)!.push(error as SchemaError)
                this.lastSchemaValidation = Date.now()
                break
        }

        this.updateErrorTexts()
    }

    removeErrorsForToken(token: string, level?: ValidationLevel): void {
        if (!level) {
            // Remove from all levels
            this.structuralErrors.delete(token)
            this.syntaxErrors.delete(token)
            this.schemaErrors.delete(token)
        } else {
            switch (level) {
                case "structural":
                    this.structuralErrors.delete(token)
                    break
                case "syntax":
                    this.syntaxErrors.delete(token)
                    break
                case "schema":
                    this.schemaErrors.delete(token)
                    break
            }
        }

        this.updateErrorTexts()
    }

    clearErrors(level?: ValidationLevel): void {
        if (!level) {
            // Clear all levels
            this.structuralErrors.clear()
            this.syntaxErrors.clear()
            this.schemaErrors.clear()
            this.multiLineTracker.clear()
        } else {
            switch (level) {
                case "structural":
                    this.structuralErrors.clear()
                    this.multiLineTracker.clear()
                    break
                case "syntax":
                    this.syntaxErrors.clear()
                    break
                case "schema":
                    this.schemaErrors.clear()
                    break
            }
        }

        this.updateErrorTexts()
    }

    updateErrorTexts(): void {
        this.errorTexts.clear()
        this.errorList = []

        // Collect all errors with priority
        const allErrors: ValidationError[] = []

        // Add structural errors (highest priority)
        for (const errors of this.structuralErrors.values()) {
            allErrors.push(...errors)
        }

        // Add syntax errors (medium priority)
        for (const errors of this.syntaxErrors.values()) {
            allErrors.push(...errors)
        }

        // Add schema errors (lowest priority)
        for (const errors of this.schemaErrors.values()) {
            allErrors.push(...errors)
        }

        // Add multi-line structural errors
        const multiLineErrors = this.multiLineTracker.getStructuralErrors()
        allErrors.push(...multiLineErrors)

        // Update errorTexts and errorList
        for (const error of allErrors) {
            if (error.token) {
                this.errorTexts.add(error.token)

                // Also add quoted/unquoted versions for better matching
                if (error.token.startsWith('"') && error.token.endsWith('"')) {
                    // Add unquoted version
                    this.errorTexts.add(error.token.slice(1, -1))
                } else if (!error.token.startsWith('"')) {
                    // Add quoted version
                    this.errorTexts.add(`"${error.token}"`)
                }
            }
        }

        this.errorList = allErrors
    }

    /**
     * Get the highest priority error for a token
     */
    getPrimaryErrorForToken(token: string): ValidationError | null {
        const errors = this.getErrorsForToken(token)

        // For syntax errors, don't check variations since we use context-specific keys
        // Only check variations for schema errors which might legitimately apply to both forms
        const schemaVariations = [
            token,
            token.startsWith('"') && token.endsWith('"') ? token.slice(1, -1) : `"${token}"`,
        ]

        for (const variation of schemaVariations) {
            const variationErrors = this.getErrorsForToken(variation)
            // Only add schema errors from variations, not syntax errors
            const schemaErrors = variationErrors.filter((e) => e.level === "schema")
            errors.push(...schemaErrors)
        }

        if (errors.length === 0) return null

        // Return the highest priority error (structural > syntax > schema)
        const structural = errors.find((e) => e.level === "structural")
        if (structural) return structural

        const syntax = errors.find((e) => e.level === "syntax")
        if (syntax) return syntax

        return errors[0] // Return first schema error
    }

    /**
     * Check if validation context has any errors
     */
    hasErrors(): boolean {
        return (
            this.structuralErrors.size > 0 ||
            this.syntaxErrors.size > 0 ||
            this.schemaErrors.size > 0 ||
            this.multiLineTracker.getStructuralErrors().length > 0
        )
    }

    /**
     * Get summary of validation state
     */
    getValidationSummary(): {
        structuralCount: number
        syntaxCount: number
        schemaCount: number
        multiLineCount: number
        totalErrors: number
    } {
        const multiLineErrors = this.multiLineTracker.getStructuralErrors()

        return {
            structuralCount: Array.from(this.structuralErrors.values()).reduce(
                (sum, errors) => sum + errors.length,
                0,
            ),
            syntaxCount: Array.from(this.syntaxErrors.values()).reduce(
                (sum, errors) => sum + errors.length,
                0,
            ),
            schemaCount: Array.from(this.schemaErrors.values()).reduce(
                (sum, errors) => sum + errors.length,
                0,
            ),
            multiLineCount: multiLineErrors.length,
            totalErrors: this.errorList.length,
        }
    }
}

// Global enhanced validation context
let globalEnhancedValidationContext = new EnhancedValidationContextImpl()

/**
 * Get the global enhanced validation context
 */
export function getEnhancedValidationContext(): EnhancedValidationContext {
    return globalEnhancedValidationContext
}

/**
 * Set the global enhanced validation context (for testing or reset)
 */
export function setEnhancedValidationContext(context: EnhancedValidationContext): void {
    globalEnhancedValidationContext = context as EnhancedValidationContextImpl
}

/**
 * Reset the global enhanced validation context
 */
export function resetEnhancedValidationContext(): void {
    globalEnhancedValidationContext = new EnhancedValidationContextImpl()
}
