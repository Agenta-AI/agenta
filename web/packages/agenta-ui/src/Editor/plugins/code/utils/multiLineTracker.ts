/**
 * Multi-line structure tracker for detecting unclosed brackets, quotes, and other structures
 */

import {BracketInfo, QuoteInfo, MultiLineTracker, StructuralError} from "./validationTypes"

export class MultiLineTrackerImpl implements MultiLineTracker {
    public openBrackets: BracketInfo[] = []
    public openQuotes: QuoteInfo[] = []

    addBracket(bracket: BracketInfo): void {
        this.openBrackets.push(bracket)
    }

    removeBracket(type: "]" | "}" | ")"): BracketInfo | null {
        const expectedOpening = type === "]" ? "[" : type === "}" ? "{" : "("

        // Find the most recent matching opening bracket
        for (let i = this.openBrackets.length - 1; i >= 0; i--) {
            if (this.openBrackets[i].type === expectedOpening) {
                return this.openBrackets.splice(i, 1)[0]
            }
        }

        return null
    }

    addQuote(quote: QuoteInfo): void {
        // Check if we're closing an existing quote of the same type
        const existingIndex = this.openQuotes.findIndex((q) => q.type === quote.type)

        if (existingIndex !== -1) {
            // Close the existing quote
            this.openQuotes.splice(existingIndex, 1)
        } else {
            // Open a new quote
            this.openQuotes.push(quote)
        }
    }

    removeQuote(type: '"' | "'"): QuoteInfo | null {
        const index = this.openQuotes.findIndex((q) => q.type === type)
        if (index !== -1) {
            return this.openQuotes.splice(index, 1)[0]
        }
        return null
    }

    getStructuralErrors(): StructuralError[] {
        const errors: StructuralError[] = []
        const now = Date.now()

        // Generate errors for unclosed brackets
        for (const bracket of this.openBrackets) {
            const expectedClosing = bracket.type === "[" ? "]" : bracket.type === "{" ? "}" : ")"
            const structureType =
                bracket.type === "[" ? "array" : bracket.type === "{" ? "object" : "parentheses"

            errors.push({
                level: "structural",
                type: bracket.type === "[" ? "unclosed_array" : "unclosed_object",
                severity: "error",
                message: `Unclosed ${structureType}`,
                token: bracket.type,
                line: bracket.line,
                column: bracket.column,
                openingChar: bracket.type,
                expectedClosing,
                openingLine: bracket.line,
                openingColumn: bracket.column,
                timestamp: now,
            })
        }

        // Generate errors for unclosed quotes
        for (const quote of this.openQuotes) {
            errors.push({
                level: "structural",
                type: "unclosed_quote",
                severity: "error",
                message: `Unclosed quote`,
                token: quote.type,
                line: quote.line,
                column: quote.column,
                openingChar: quote.type,
                expectedClosing: quote.type,
                openingLine: quote.line,
                openingColumn: quote.column,
                timestamp: now,
            })
        }

        return errors
    }

    clear(): void {
        this.openBrackets = []
        this.openQuotes = []
    }
}
