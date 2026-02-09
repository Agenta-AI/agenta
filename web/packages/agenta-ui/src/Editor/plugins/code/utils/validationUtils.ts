import yaml from "js-yaml"
import JSON5 from "json5"

import type {CodeLanguage} from "../types"

// Enhanced validation functions for irregular and chaotic input detection

/**
 * Detect text that appears before or after the main JSON block
 */
function detectTextOutsideJSON(textContent: string, lines: string[]): ErrorInfo[] {
    const errors: ErrorInfo[] = []
    const trimmed = textContent.trim()

    if (!trimmed) return errors

    // Find the start and end of the main JSON structure
    const jsonStart = Math.min(
        trimmed.indexOf("{") === -1 ? Infinity : trimmed.indexOf("{"),
        trimmed.indexOf("[") === -1 ? Infinity : trimmed.indexOf("["),
    )
    const jsonEnd = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"))

    if (jsonStart === Infinity || jsonEnd === -1) {
        return errors // No clear JSON structure found
    }

    // Check for text before JSON
    const beforeJSON = trimmed.substring(0, jsonStart).trim()
    if (beforeJSON) {
        errors.push({
            id: "text-before-json",
            line: 1,
            message: "Text found before JSON structure",
            type: "structural",
            severity: "error",
        })
    }

    // Check for text after JSON
    const afterJSON = trimmed.substring(jsonEnd + 1).trim()
    if (afterJSON) {
        // Find the line where the text after JSON appears
        const afterJSONLine = lines.findIndex((line, index) => {
            const cumulativeLength = lines.slice(0, index + 1).join("\n").length
            return cumulativeLength > jsonEnd
        })

        errors.push({
            id: "text-after-json",
            line: afterJSONLine > 0 ? afterJSONLine + 1 : lines.length,
            message: "Text found after JSON structure",
            type: "structural",
            severity: "error",
        })
    }

    return errors
}

/**
 * Detect content that doesn't appear to be JSON at all
 */
function detectNonJSONText(textContent: string, lines: string[]): ErrorInfo[] {
    const errors: ErrorInfo[] = []
    const trimmed = textContent.trim()

    if (!trimmed) return errors

    // Check if content has any JSON-like structure
    const hasJSONStructure = /[{}\[\]]/.test(trimmed) || /"[^"]*"\s*:/.test(trimmed)

    if (!hasJSONStructure) {
        errors.push({
            id: "non-json-content",
            line: 1,
            message: "Content does not appear to be JSON",
            type: "structural",
            severity: "error",
        })
    }

    return errors
}

/**
 * Detect multiple top-level JSON objects or arrays
 */
function detectMultipleJSONObjects(textContent: string): ErrorInfo[] {
    const errors: ErrorInfo[] = []
    const trimmed = textContent.trim()

    if (!trimmed) return errors

    // Try to detect multiple JSON objects by looking for patterns like }\s*{
    const multipleObjectPattern = /}\s*{/g
    const multipleArrayPattern = /]\s*\[/g
    const objectThenArray = /}\s*\[/g
    const arrayThenObject = /]\s*{/g

    if (
        multipleObjectPattern.test(trimmed) ||
        multipleArrayPattern.test(trimmed) ||
        objectThenArray.test(trimmed) ||
        arrayThenObject.test(trimmed)
    ) {
        errors.push({
            id: "multiple-json-objects",
            line: 1,
            message: "Multiple top-level JSON objects/arrays are not allowed",
            type: "structural",
            severity: "error",
        })
    }

    return errors
}

/**
 * Detect invalid tokens that shouldn't appear in JSON
 */
function detectInvalidTokens(lines: string[]): ErrorInfo[] {
    const errors: ErrorInfo[] = []

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const lineNumber = i + 1

        // Skip empty lines
        if (!line.trim()) continue

        // Check for HTML tags
        if (/<[^>]+>/.test(line)) {
            errors.push({
                id: `html-tags-${lineNumber}`,
                line: lineNumber,
                message: "HTML tags are not valid in JSON",
                type: "syntax",
                severity: "error",
            })
        }

        // Check for JavaScript keywords
        const jsKeywords =
            /\b(function|var|let|const|if|else|for|while|return|class|extends|import|export)\b/
        if (jsKeywords.test(line)) {
            errors.push({
                id: `js-keywords-${lineNumber}`,
                line: lineNumber,
                message: "JavaScript keywords are not valid in JSON",
                type: "syntax",
                severity: "error",
            })
        }

        // Check for mathematical expressions
        if (/\b\d+\s*[+\-*/=]\s*\d+/.test(line)) {
            errors.push({
                id: `math-expressions-${lineNumber}`,
                line: lineNumber,
                message: "Mathematical expressions are not valid in JSON",
                type: "syntax",
                severity: "error",
            })
        }

        // Check for binary/hex numbers
        if (/\b0[bx][0-9a-fA-F]+\b/.test(line)) {
            errors.push({
                id: `binary-hex-${lineNumber}`,
                line: lineNumber,
                message: "Binary/hex numbers are not valid in JSON",
                type: "syntax",
                severity: "error",
            })
        }

        // Check for unquoted emojis/unicode (outside of strings)
        const emojiRegex =
            /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u

        // Split line by quotes to separate quoted and unquoted parts
        const parts = line.split('"')
        for (let j = 0; j < parts.length; j += 2) {
            // Even indices are outside quotes
            const unquotedPart = parts[j]
            if (emojiRegex.test(unquotedPart)) {
                errors.push({
                    id: `unquoted-emoji-${lineNumber}`,
                    line: lineNumber,
                    message: "Unquoted emoji/unicode characters are not valid in JSON",
                    type: "syntax",
                    severity: "error",
                })
                break
            }
        }
    }

    return errors
}

/**
 * Detect standalone values that should be part of an object or array
 */
function detectStandaloneValues(lines: string[]): ErrorInfo[] {
    const errors: ErrorInfo[] = []

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        const lineNumber = i + 1

        // Skip empty lines, comments, and lines with structural characters
        if (!line || line.startsWith("//") || /[{}\[\],:]/.test(line)) {
            continue
        }

        // Check if this looks like a standalone value (string, number, boolean)
        if (/^("[^"]*"|\d+|true|false|null)\s*$/.test(line)) {
            errors.push({
                id: `standalone-value-${lineNumber}`,
                line: lineNumber,
                message: "Standalone values must be part of an object or array",
                type: "syntax",
                severity: "error",
            })
        }
    }

    return errors
}

export interface ErrorInfo {
    id: string
    line: number
    message: string
    type: "syntax" | "schema" | "bracket" | "structural"
    severity: "error" | "warning"
}

/**
 * Main validation function - validates both JSON/YAML syntax and schema
 * @param textContent - The content to validate
 * @param schema - Optional schema for validation
 * @param language - The language format ('json' or 'yaml')
 * @param _editedLineContent - Unused parameter for compatibility
 * @param cleanedToOriginalLineMap - Unused parameter for compatibility
 */
export function validateAll(
    textContent: string,
    schema?: Record<string, unknown>,
    language: CodeLanguage = "json",
    _editedLineContent?: string,
    cleanedToOriginalLineMap?: Map<number, number>,
): {
    allErrors: ErrorInfo[]
    errorsByLine: Map<number, ErrorInfo[]>
    structuralErrors: ErrorInfo[]
    bracketErrors: ErrorInfo[]
    schemaErrors: ErrorInfo[]
} {
    const lines = textContent.split("\n")
    const errors: ErrorInfo[] = []

    // Handle empty input
    if (!textContent || textContent.trim() === "") {
        return {
            allErrors: [],
            errorsByLine: new Map(),
            structuralErrors: [],
            bracketErrors: [],
            schemaErrors: [],
        }
    }

    if (
        language === "code" ||
        language === "python" ||
        language === "javascript" ||
        language === "typescript"
    ) {
        return {
            allErrors: [],
            errorsByLine: new Map(),
            structuralErrors: [],
            bracketErrors: [],
            schemaErrors: [],
        }
    }

    // 1. Try native parsing first (fast path for valid content)
    try {
        if (language === "json") {
            JSON.parse(textContent)
        } else {
            yaml.load(textContent)
        }
        // If we reach here, it's valid content - only run schema validation if needed
        const schemaErrors = schema ? validateSchema(textContent, schema, lines, language) : []
        const errorsByLine = new Map<number, ErrorInfo[]>()
        for (const error of schemaErrors) {
            const lineErrors = errorsByLine.get(error.line) || []
            lineErrors.push(error)
            errorsByLine.set(error.line, lineErrors)
        }
        return {
            allErrors: schemaErrors,
            errorsByLine,
            structuralErrors: [],
            bracketErrors: [],
            schemaErrors,
        }
    } catch (nativeError) {
        // Continue with detailed validation
    }

    // 2. Language-specific validation for invalid content
    let structuralErrors: ErrorInfo[] = []
    let bracketErrors: ErrorInfo[] = []

    if (language === "json") {
        // JSON-specific validation

        // Try JSON5 parsing to detect non-strict JSON
        try {
            JSON5.parse(textContent)
            errors.push({
                id: "non-strict-json",
                line: 1,
                message: "Invalid JSON syntax - use strict JSON format",
                type: "syntax",
                severity: "error",
            })
        } catch (json5Error) {
            // Continue with enhanced validation for irregular input
        }

        // Enhanced validation for irregular and chaotic input
        errors.push(...detectTextOutsideJSON(textContent, lines))
        errors.push(...detectNonJSONText(textContent, lines))
        errors.push(...detectMultipleJSONObjects(textContent))
        errors.push(...detectInvalidTokens(lines))

        // Original line-by-line validation for traditional JSON errors
        errors.push(...detectStandaloneValues(lines))
        errors.push(...detectTrailingCommas(lines))
        errors.push(...detectUnclosedStrings(lines))

        // Check for structural errors (malformed JSON5)
        structuralErrors = validateStructure(textContent, lines)
        errors.push(...structuralErrors)

        // Check for bracket/brace errors
        bracketErrors = validateBrackets(textContent, lines)
        errors.push(...bracketErrors)
    } else {
        // YAML-specific validation
        errors.push(...detectYAMLSyntaxErrors(textContent, lines))
    }

    // 5. Check for schema errors (only if we have a schema)
    const schemaErrors = schema ? validateSchema(textContent, schema, lines, language) : []
    errors.push(...schemaErrors)

    // Group errors by line
    const errorsByLine = new Map<number, ErrorInfo[]>()
    for (const error of errors) {
        const lineErrors = errorsByLine.get(error.line) || []
        lineErrors.push(error)
        errorsByLine.set(error.line, lineErrors)
    }

    return {
        allErrors: errors,
        errorsByLine,
        structuralErrors,
        bracketErrors,
        schemaErrors,
    }
}

/**
 * Validate JSON5 structure - check for malformed key:value pairs
 */
function validateStructure(textContent: string, lines: string[]): ErrorInfo[] {
    const errors: ErrorInfo[] = []

    // Always run structural validation for strict JSON compliance
    // (even if JSON5 parsing succeeds, we want to enforce stricter rules)
    let contextStack: string[] = [] // Track nesting context: 'object' or 'array'
    let _hasParseError = false

    // Check if JSON5 parsing fails
    try {
        JSON5.parse(textContent)
    } catch (_parseError) {
        _hasParseError = true
    }

    // Analyze line by line for specific issues with context tracking

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        const lineNumber = i + 1
        const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : null

        // Skip empty lines and comments
        if (!line || line.startsWith("//")) continue

        // Get context BEFORE updating the stack for this line
        const currentContext = contextStack[contextStack.length - 1] || "object"

        // Check for malformed key:value patterns (context-aware)

        // Update context stack based on brackets AFTER getting the context
        for (const char of line) {
            if (char === "{") {
                contextStack.push("object")
            } else if (char === "[") {
                contextStack.push("array")
            } else if (char === "}" || char === "]") {
                contextStack.pop()
            }
        }
        const malformedResult = isMalformedPropertyInContext(line, currentContext)
        if (malformedResult) {
            if (typeof malformedResult === "object" && malformedResult.isWarning) {
                // Handle warning case

                errors.push({
                    id: `structural-warning-${lineNumber}`,
                    line: lineNumber,
                    message: malformedResult.message,
                    type: "syntax",
                    severity: "warning",
                })
            } else {
                // Handle error case (boolean true)

                errors.push({
                    id: `structural-error-${lineNumber}`,
                    line: lineNumber,
                    message: getStructuralErrorMessage(line),
                    type: "syntax",
                    severity: "error",
                })
            }
        }

        // Check for missing comma: property ending followed by another property at the same level
        if (
            (isCompleteProperty(line) || isPropertyEnding(line)) &&
            nextLine &&
            isPropertyStart(nextLine) &&
            !line.endsWith(",") &&
            !line.endsWith("{") &&
            !line.endsWith("[")
        ) {
            errors.push({
                id: `comma-error-${lineNumber}`,
                line: lineNumber,
                message: "Missing comma after property",
                type: "syntax",
                severity: "error",
            })
        }

        // Check for missing comma: array element followed by another array element
        if (
            isArrayElement(line) &&
            nextLine &&
            isArrayElement(nextLine) &&
            !line.endsWith(",") &&
            !line.endsWith("{") &&
            !line.endsWith("[")
        ) {
            errors.push({
                id: `comma-error-${lineNumber}`,
                line: lineNumber,
                message: "Missing comma after array element",
                type: "syntax",
                severity: "error",
            })
        }
    }

    return errors
}

/**
 * Detect trailing commas by looking ahead to see if there's another property after a comma
 */
function detectTrailingCommas(lines: string[]): ErrorInfo[] {
    const errors: ErrorInfo[] = []

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        const lineNumber = i + 1

        // Check if this line ends with a comma
        if (line.endsWith(",")) {
            // Look ahead to find the next non-empty, non-comment line
            let nextContentLine = ""
            let nextLineIndex = i + 1

            while (nextLineIndex < lines.length) {
                const nextLine = lines[nextLineIndex].trim()
                if (nextLine && !nextLine.startsWith("//")) {
                    nextContentLine = nextLine
                    break
                }
                nextLineIndex++
            }

            // If the next content line is a closing brace/bracket, this is a trailing comma
            if (nextContentLine.startsWith("}") || nextContentLine.startsWith("]")) {
                errors.push({
                    id: `trailing-comma-${lineNumber}`,
                    line: lineNumber,
                    message: "Invalid JSON syntax - trailing comma not allowed",
                    type: "syntax",
                    severity: "error",
                })
            }
        }
    }

    return errors
}

/**
 * Validate a line using JSON5 parser with strategic wrapping
 * This replaces the custom tokenizer with a proper parser-based approach
 */
function validateLineWithParser(
    line: string,
    context: string,
): {valid: boolean; error?: string; warning?: string} {
    // Skip empty lines and structural characters
    const trimmedLine = line.trim()
    if (!trimmedLine || /^[{}\[\],]*$/.test(trimmedLine)) {
        return {valid: true}
    }

    // Special handling for incomplete object/array properties
    if (context === "object" && /^"[^"]+"\s*:\s*[{\[]\s*$/.test(trimmedLine)) {
        return {valid: true}
    }

    // Special handling for incomplete array elements that start objects/arrays
    if (context === "array" && /^[{\[]\s*$/.test(trimmedLine)) {
        return {valid: true}
    }

    // Try different JSON wrapping strategies to validate the line
    const testcases = []

    if (context === "array") {
        // For array elements, test as array items first
        testcases.push(
            {test: `[${trimmedLine}]`, description: "wrapped as array"},
            {
                test: `[${trimmedLine.replace(/,\s*$/, "")}]`,
                description: "wrapped as array without comma",
            },
            {test: trimmedLine, description: "as-is"},
        )
    } else {
        // For object context, test as object properties
        testcases.push(
            // Test as-is (for complete JSON fragments)
            {test: trimmedLine, description: "as-is"},
            // Test as object property
            {test: `{${trimmedLine}}`, description: "wrapped as object"},
            // Test as property value
            {test: `{"key": ${trimmedLine}}`, description: "as property value"},
            // Test with trailing comma removed
            {test: `{${trimmedLine.replace(/,\s*$/, "")}}`, description: "without trailing comma"},
        )
    }

    let lastError = ""

    for (const testcase of testcases) {
        try {
            // Use native JSON.parse for strict JSON validation
            JSON.parse(testcase.test)

            // If we get here, the JSON is valid
            // But we need to check for JSON5-specific issues that JSON.parse allows
            const validationResult = validateStrictJSON(trimmedLine, context)
            if (!validationResult.valid) {
                return validationResult
            }

            // If there's a warning, return it
            if (validationResult.warning) {
                return validationResult
            }

            return {valid: true}
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error)
            continue
        }
    }

    // If all testcases failed, analyze the error for better messaging
    const enhancedError = enhanceErrorMessage(trimmedLine, lastError, context)

    return {valid: false, error: enhancedError}
}

/**
 * Validate strict JSON compliance (catch JSON5 features that JSON.parse might miss)
 */
function validateStrictJSON(
    line: string,
    context: string,
): {valid: boolean; error?: string; warning?: string} {
    // Check for single quotes (invalid in JSON)
    if (line.includes("'")) {
        const singleQuoteMatch = line.match(/'([^']*)'/)
        if (singleQuoteMatch) {
            return {
                valid: false,
                error: `Invalid single-quoted string '${singleQuoteMatch[1]}' - JSON requires double quotes`,
            }
        }
    }

    // Check for unquoted keys
    const unquotedKeyMatch = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/)
    if (unquotedKeyMatch) {
        return {
            valid: false,
            error: `Unquoted key "${unquotedKeyMatch[1]}" - keys must be quoted strings`,
        }
    }

    // Check for incomplete object properties (key without value)
    if (context === "object" && /^\s*"[^"]*"\s*$/.test(line)) {
        return {
            valid: false,
            error: "Incomplete property - missing colon and value",
        }
    }

    // Check for trailing commas in objects/arrays
    if (/,\s*[}\]]/.test(line)) {
        return {
            valid: false,
            error: "Trailing comma not allowed in JSON",
        }
    }

    // Check for empty string keys (warning)
    if (/""\s*:/.test(line)) {
        return {
            valid: true,
            warning: "Empty key name - consider using a meaningful key",
        }
    }

    // Check for standalone values in object context (invalid)
    if (context === "object") {
        const trimmed = line.trim()
        // Check if it's a standalone value (number, string, boolean) without key:value format
        if (/^(\d+|"[^"]*"|true|false|null)\s*,?$/.test(trimmed) && !/"[^"]*"\s*:/.test(trimmed)) {
            return {
                valid: false,
                error: 'Standalone value in object - expected "key": value format',
            }
        }
    }

    // Check for invalid JSON values
    const invalidValues = ["undefined", "NaN", "Infinity", "-Infinity"]
    for (const invalidValue of invalidValues) {
        if (new RegExp(`\\b${invalidValue}\\b`).test(line)) {
            return {
                valid: false,
                error: `Invalid JSON value "${invalidValue}" - not supported in JSON`,
            }
        }
    }

    return {valid: true}
}

/**
 * Enhance error messages to be more user-friendly and specific
 */
function enhanceErrorMessage(line: string, originalError: string, context: string): string {
    // Common error patterns and their enhanced messages
    if (originalError.includes("Unexpected token")) {
        if (line.includes("'")) {
            return "Invalid single quotes - JSON requires double quotes for strings"
        }
        if (/^"[^"]*"\s*:/.test(line)) {
            return "Unquoted key detected - keys must be quoted strings in JSON"
        }
        if (line.includes("undefined")) {
            return 'Invalid value "undefined" - use null or a quoted string instead'
        }
    }

    if (originalError.includes("Unexpected end")) {
        return "Incomplete JSON syntax - missing closing quote, bracket, or brace"
    }

    if (originalError.includes("Expected")) {
        if (context === "object") {
            return 'Invalid object property syntax - expected "key": value format'
        } else {
            return "Invalid array element syntax"
        }
    }

    // Return a cleaned up version of the original error
    return originalError
        .replace(/^SyntaxError: /, "")
        .replace(/in JSON at position \d+/, "")
        .replace(/^\s+/, "") // Remove leading whitespace
        .trim()
}

/**
 * Check if a line contains a malformed property (using parser-based validation)
 */
function isMalformedPropertyInContext(
    line: string,
    context: string,
): boolean | {isWarning: true; message: string} {
    // Use the new parser-based validation
    const result = validateLineWithParser(line, context)

    if (!result.valid) {
        return true
    }

    if (result.warning) {
        return {isWarning: true, message: result.warning}
    }

    return false
}

/**
 * Check if a line contains a malformed property (legacy - kept for compatibility)
 */
function _isMalformedProperty(line: string): boolean {
    // Skip structural characters
    if (line.match(/^[{}\[\],]*$/)) return false

    // Pattern 1: Missing comma (property followed by another property)
    if (line.match(/^"[^"]*":\s*"[^"]*"$/) || line.match(/^"[^"]*":\s*\d+$/)) {
        // This looks like a complete property, check if it needs a comma
        // (This will be handled by comma detection logic)
        return false
    }

    // Pattern 2: Incomplete property - just a key without value
    if (line.match(/^"[^"]*"$/)) {
        return true
    }

    // Pattern 3: Bare identifier (unquoted key)
    if (line.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
        return true
    }

    // Pattern 4: Key with colon but no value (like "a":)
    if (line.match(/^"[^"]*":\s*$/)) {
        return true
    }

    // Pattern 5: Key with empty value
    if (line.match(/^"[^"]*":\s*""$/)) {
        return true
    }

    // Pattern 6: Key without colon or value
    if (line.match(/^"[^"]*"\s*$/)) {
        return true
    }

    // Pattern 7: Standalone value at object level (not a property)
    // This catches cases like "4", "4,", "hello", "hello," that appear outside arrays
    if (line.match(/^\s*(\d+|"[^"]*"|true|false|null)\s*,?\s*$/)) {
        return true
    }

    return false
}

/**
 * Get appropriate error message for structural issues
 */
function getStructuralErrorMessage(line: string): string {
    if (line.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
        return "Invalid JSON syntax - keys must be quoted"
    }
    if (line.match(/^[a-zA-Z_][a-zA-Z0-9_]*\s*:\s*.+$/)) {
        return "Invalid JSON syntax - keys must be quoted"
    }
    if (line.match(/^[a-zA-Z_][a-zA-Z0-9_]*\s*:\s*$/)) {
        return "Invalid JSON syntax - keys must be quoted"
    }
    if (line.match(/^\d+\s*:.*$/)) {
        return "Invalid JSON syntax - keys must be quoted"
    }
    if (line.match(/^"[^"]*":\s*$/)) {
        return "Incomplete property - missing value after colon"
    }
    if (line.match(/^"[^"]*":\s*""$/)) {
        return "Property has empty value - provide a valid value"
    }
    if (line.match(/^"[^"]*"$/)) {
        return "Incomplete property - missing value"
    }
    if (line.match(/^\s*(\d+|"[^"]*"|true|false|null)\s*,?\s*$/)) {
        return "Unexpected value - values must be part of a property or array"
    }
    if (line.match(/^\s*,\s*$/) || line.match(/^\s*[}\]]\s*,\s*$/)) {
        return "Invalid JSON syntax - trailing comma not allowed"
    }
    return "Invalid JSON syntax - check property format"
}

/**
 * Check if a line contains a complete property (key: value)
 */
function isCompleteProperty(line: string): boolean {
    // Match patterns like "key": "value", "key": 123, "key": true, etc.
    return /^"[^"]*":\s*(.+)$/.test(line)
}

/**
 * Check if a line starts a new property (begins with a quoted key)
 */
function isPropertyStart(line: string): boolean {
    return /^"[^"]*"/.test(line)
}

/**
 * Check if a line ends a property (closing bracket/brace from multi-line structure)
 */
function isPropertyEnding(line: string): boolean {
    // Match lines that are just closing brackets/braces (possibly with whitespace)
    return /^\s*[}\]]\s*$/.test(line)
}

/**
 * Check if a line contains an array element (number, string, boolean, etc.)
 */
function isArrayElement(line: string): boolean {
    // Match lines that contain array elements: numbers, strings, booleans, null
    // But exclude lines that start object properties or are just brackets
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("//")) return false
    if (/^[{}\[\]]$/.test(trimmed)) return false // Just brackets
    if (/^"[^"]*"\s*:/.test(trimmed)) return false // Object property

    // Match common array element patterns
    return /^\s*(\d+|"[^"]*"|true|false|null|\{|\[)/.test(line)
}

/**
 * Validate bracket/brace matching - highlight entire unclosed block spans
 */
function validateBrackets(textContent: string, lines: string[]): ErrorInfo[] {
    const errors: ErrorInfo[] = []
    const stack: {char: string; line: number}[] = []
    const openBrackets = ["{", "["] as const
    const closeBrackets = ["}", "]"] as const
    const pairs: Record<string, string> = {"{": "}", "[": "]"}

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const lineNumber = i + 1

        for (const char of line) {
            if (openBrackets.includes(char as "{" | "[")) {
                stack.push({char, line: lineNumber})
            } else if (closeBrackets.includes(char as "}" | "]")) {
                if (stack.length === 0) {
                    errors.push({
                        id: `bracket-error-${lineNumber}`,
                        line: lineNumber,
                        message: `Unexpected closing ${char}`,
                        type: "bracket",
                        severity: "error",
                    })
                } else {
                    const last = stack.pop()!
                    const expectedChar = pairs[last.char]
                    if (expectedChar && expectedChar !== char) {
                        // Check if this closing bracket has a matching opening bracket in the stack
                        const hasMatchingOpen = stack.some((item) => pairs[item.char] === char)

                        if (hasMatchingOpen) {
                            // This is a mismatch - push the bracket back for unclosed detection
                            stack.push(last)
                        } else {
                            // This is an unexpected closing bracket - don't add individual errors
                            // as they'll be covered by unclosed block highlighting
                            // errors.push({
                            //     id: `bracket-error-${lineNumber}`,
                            //     line: lineNumber,
                            //     message: `Unexpected closing ${char}`,
                            //     type: "bracket",
                            //     severity: "error",
                            // })
                            stack.push(last)
                        }
                    }
                }
            }
        }
    }

    // Handle unclosed brackets - only highlight the innermost unclosed block
    if (stack.length > 0) {
        // Only report the last (innermost) unclosed bracket
        const unclosed = stack[stack.length - 1]

        const startLine = unclosed.line
        const endLine = findBlockEnd(lines, startLine - 1, unclosed.char)

        // Highlight only the lines that belong to the innermost unclosed block
        for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
            errors.push({
                id: `unclosed-block-${lineNum}`,
                line: lineNum,
                message: `Unclosed ${unclosed.char} block started on line ${startLine}`,
                type: "bracket",
                severity: "error",
            })
        }
    }

    return errors
}

/**
 * Detect YAML-specific syntax errors
 */
function detectYAMLSyntaxErrors(textContent: string, lines: string[]): ErrorInfo[] {
    const errors: ErrorInfo[] = []

    try {
        // Try to parse with js-yaml to get detailed error information
        yaml.load(textContent)
    } catch (yamlError) {
        // Extract line number from YAML error if available
        let lineNumber = 1
        const yamlErr = yamlError as {mark?: {line?: number}; message?: string}
        if (yamlErr.mark && yamlErr.mark.line !== undefined) {
            lineNumber = yamlErr.mark.line + 1 // js-yaml uses 0-based line numbers
        }

        // Create a more user-friendly error message
        let message = "Invalid YAML syntax"
        if (yamlErr.message) {
            // Clean up the error message to be more user-friendly
            message = yamlErr.message
                .replace(/at line \d+, column \d+:/, "") // Remove position info since we show it separately
                .replace(/^\s+/, "") // Remove leading whitespace
                .trim()

            // Make the message more user-friendly
            if (message.includes("duplicated mapping key")) {
                message = "Duplicate key found - YAML keys must be unique"
            } else if (message.includes("bad indentation")) {
                message = "Incorrect indentation - YAML requires consistent spacing"
            } else if (message.includes("expected")) {
                message = "Invalid YAML structure - check syntax and indentation"
            }
        }

        errors.push({
            id: `yaml-syntax-error-${lineNumber}`,
            line: lineNumber,
            message,
            type: "syntax",
            severity: "error",
        })
    }

    return errors
}

/**
 * Detect unclosed strings in JSON content
 */
function detectUnclosedStrings(lines: string[]): ErrorInfo[] {
    const errors: ErrorInfo[] = []

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const lineNumber = i + 1

        // Check for unclosed string (improved detection)
        if (line.includes('"')) {
            // Count unescaped quotes
            let quoteCount = 0
            let j = 0

            while (j < line.length) {
                if (line[j] === '"' && (j === 0 || line[j - 1] !== "\\")) {
                    quoteCount++
                }
                j++
            }

            // If we have an odd number of quotes, string is unclosed
            if (quoteCount % 2 === 1) {
                errors.push({
                    id: `unclosed-string-${lineNumber}`,
                    line: lineNumber,
                    message: "Unclosed string - missing closing quote",
                    type: "syntax",
                    severity: "error",
                })
            }
        }
    }

    return errors
}

/**
 * Validate against JSON/YAML schema
 */
function validateSchema(
    textContent: string,
    schema: Record<string, unknown>,
    lines: string[],
    language: CodeLanguage = "json",
): ErrorInfo[] {
    const errors: ErrorInfo[] = []

    if (
        language === "code" ||
        language === "python" ||
        language === "javascript" ||
        language === "typescript"
    ) {
        return errors
    }

    try {
        // For schema validation, we'll use a simple approach:
        // Always check for missing required properties regardless of JSON validity

        // Check for missing required properties - must be at root level
        if (schema.required) {
            try {
                let parsedContent: Record<string, unknown>
                if (language === "json") {
                    parsedContent = JSON5.parse(textContent) as Record<string, unknown>
                } else {
                    parsedContent = yaml.load(textContent) as Record<string, unknown>
                }
                for (const requiredProp of schema.required as string[]) {
                    // Check if the required property exists at the root level
                    if (!(requiredProp in parsedContent)) {
                        errors.push({
                            id: `schema-missing-${requiredProp}`,
                            line: 1, // Always highlight the opening brace
                            message: `Missing required property: "${requiredProp}"`,
                            type: "schema",
                            severity: "error",
                        })
                    } else {
                    }
                }
            } catch (parseError) {
                // When content is malformed, fall back to text-based validation
                // This checks if the property exists anywhere in the text (less precise but more forgiving)
                for (const requiredProp of schema.required as string[]) {
                    let propRegex: RegExp
                    if (language === "json") {
                        propRegex = new RegExp(`"${requiredProp}"\\s*:`, "i")
                    } else {
                        // YAML can use both quoted and unquoted keys
                        propRegex = new RegExp(`(^|\\s)${requiredProp}\\s*:`, "im")
                    }

                    if (!propRegex.test(textContent)) {
                        errors.push({
                            id: `schema-missing-${requiredProp}`,
                            line: 1,
                            message: `Missing required property: "${requiredProp}"`,
                            type: "schema",
                            severity: "error",
                        })
                    } else {
                    }
                }
            }
        }

        // Check for wrong value types by trying to parse the content
        try {
            let parsedContent: Record<string, unknown>
            if (language === "json") {
                parsedContent = JSON5.parse(textContent) as Record<string, unknown>
            } else {
                parsedContent = yaml.load(textContent) as Record<string, unknown>
            }

            if (schema.properties) {
                const schemaProps = schema.properties as Record<string, Record<string, unknown>>
                for (const [propName, propSchema] of Object.entries(schemaProps)) {
                    if (propName in parsedContent) {
                        const actualValue = parsedContent[propName]
                        const actualType = Array.isArray(actualValue) ? "array" : typeof actualValue

                        // Handle different schema formats
                        let expectedTypes: string[] = []
                        let isValidType = false

                        if (propSchema.type) {
                            // Direct type specification
                            expectedTypes = [propSchema.type as string]
                            isValidType = expectedTypes.includes(actualType)
                        } else if (propSchema.anyOf) {
                            // anyOf specification - check if actualType matches any of the allowed types
                            const anyOfItems = propSchema.anyOf as {type?: string}[]
                            expectedTypes = anyOfItems
                                .filter((item) => item.type)
                                .map((item) => item.type as string)
                            isValidType = expectedTypes.includes(actualType)
                        }

                        if (expectedTypes.length > 0 && !isValidType) {
                            const propertyLine = findPropertyLine(lines, propName, language)
                            const expectedTypesStr =
                                expectedTypes.length === 1
                                    ? expectedTypes[0]
                                    : expectedTypes.join(" or ")
                            errors.push({
                                id: `schema-type-${propName}`,
                                line: propertyLine > 0 ? propertyLine : 1,
                                message: `Property "${propName}" has wrong type: expected ${expectedTypesStr}, got ${actualType}`,
                                type: "schema",
                                severity: "error",
                            })
                        }
                    }
                }
            }
        } catch (parseError) {
            // Skip type validation if content is malformed
        }

        return errors
    } catch (error) {
        console.error("Schema validation error:", error)
        return []
    }
}

/**
 * Find the line number where a property is defined
 */
function findPropertyLine(
    lines: string[],
    propertyName: string,
    language: CodeLanguage = "json",
): number {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (language === "json") {
            // JSON uses quoted property names
            if (line.includes(`"${propertyName}"`)) {
                return i + 1
            }
        } else if (language === "yaml") {
            // YAML can use both quoted and unquoted property names
            if (line.includes(`"${propertyName}"`) || line.includes(`${propertyName}:`)) {
                return i + 1
            }
        }
    }
    return 0
}

/**
 * Find the end line of an unclosed block by looking for the next property at the same level
 */
function findBlockEnd(lines: string[], startIndex: number, openChar: string): number {
    let depth = 1
    const closeChar = openChar === "{" ? "}" : "]"

    for (let i = startIndex + 1; i < lines.length; i++) {
        const line = lines[i]

        // Count nested brackets to track depth
        for (const char of line) {
            if (char === openChar) {
                depth++
            } else if (char === closeChar) {
                depth--
                if (depth === 0) {
                    // Found the matching closing bracket
                    return i + 1
                }
            }
        }

        // If we encounter a property at the same level as the unclosed block,
        // that's where the block should have ended
        if (depth === 1 && /^\s*"[^"]*"\s*:/.test(line)) {
            return i // End just before the next property
        }

        // If we encounter a closing brace at depth 1 (same level as unclosed block),
        // the unclosed block should end at the last non-empty line before this
        if (depth === 1 && line.trim() === "}") {
            // Find the last non-empty line before this closing brace
            for (let j = i - 1; j >= startIndex; j--) {
                if (lines[j].trim() !== "") {
                    return j + 1
                }
            }
            return i
        }
    }

    // If no clear end found, highlight to the end of content
    return lines.length
}
