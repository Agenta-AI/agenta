/**
 * Pure validation utility functions for the unified validation system.
 * These functions take text content and return validation errors without side effects.
 */

import JSON5 from "json5"

import {ErrorInfo} from "../plugins/GlobalErrorIndicatorPlugin"

/**
 * JSON5-based validation that provides clean, UX-focused error messages.
 * Instead of multiple confusing bracket errors, gives one clear error per issue.
 * @param textContent - The JSON text to validate
 * @returns Array of validation errors
 */
function validateWithJSON5(textContent: string, editedLineContent?: string): ErrorInfo[] {
    const errors: ErrorInfo[] = []

    // Quick heuristic: If the edited line looks like active typing, skip validation
    // This prevents validation from interfering with undo/redo history
    if (editedLineContent) {
        // console.log(`🔧 [validateWithJSON5] Active typing check on edited line:`, {
        //     editedLineContent: `"${editedLineContent}"`,
        //     matchesColonSpace: !!editedLineContent.match(/^"[^"]*":\s*$/),
        //     matchesColon: !!editedLineContent.match(/^"[^"]*":$/),
        //     matchesKey: !!editedLineContent.match(/^"[^"]*"$/),
        //     matchesIncomplete: !!editedLineContent.match(/^"[^"]*$/),
        // })

        // Skip validation if the edited line looks like incomplete typing
        if (
            editedLineContent.match(/^"[^"]*":\s*$/) || // "key":
            editedLineContent.match(/^"[^"]*":$/) || // "key":
            editedLineContent.match(/^"[^"]*"$/) || // "key"
            editedLineContent.match(/^"[^"]*$/)
        ) {
            // console.log(
            //     `🔧 [validateWithJSON5] Skipping validation - edited line looks like active typing: "${editedLineContent}"`,
            // )
            return []
        }
    }

    try {
        JSON5.parse(textContent)
        // If parsing succeeds, no errors
        return []
    } catch (error: any) {
        // console.log(`🔧 [validateWithJSON5] JSON5 parsing failed:`, {
        //     error: error.message,
        //     lineNumber: error.lineNumber,
        //     columnNumber: error.columnNumber,
        // })

        // Extract line number from JSON5 error and map to actual text lines
        let lineNumber = 1
        if (error.lineNumber) {
            lineNumber = error.lineNumber
        } else {
            // Fallback: try to extract line number from error message
            const lineMatch = error.message.match(/line (\d+)/)
            if (lineMatch) {
                lineNumber = parseInt(lineMatch[1], 10)
            }
        }

        // console.log(`🔧 [validateWithJSON5] Raw JSON5 line number: ${lineNumber}`)

        // JSON5 line numbers include empty lines, but we need to map to actual text structure
        // Let's find the actual line in textContent that corresponds to the JSON5 line
        const lines = textContent.split("\n")
        let actualErrorLine = lineNumber

        // Verify the line number makes sense with our text content
        if (lineNumber > lines.length) {
            // JSON5 line number is beyond our text - use last line
            actualErrorLine = lines.length
        }

        // console.log(
        //     `🔧 [validateWithJSON5] Mapped to actual line: ${actualErrorLine} (total lines: ${lines.length})`,
        // )
        // console.log(
        //     `🔧 [validateWithJSON5] Line content at ${actualErrorLine}: "${lines[actualErrorLine - 1]?.trim() || ""}"`,
        // )

        // // Debug: Show all lines to understand the structure
        // console.log(
        //     `🔧 [validateWithJSON5] All lines:`,
        //     lines.map((line, i) => `${i + 1}: "${line.trim()}"`).filter((_, i) => i < 10),
        // )

        // Create a clean, user-friendly error message
        let cleanMessage = error.message

        // Transform common JSON5 errors into UX-friendly messages with better context
        if (error.message.includes("Unexpected end of JSON input")) {
            cleanMessage = "Incomplete JSON structure - missing closing brackets or braces"
        } else if (error.message.includes("invalid character")) {
            const lines = textContent.split("\n")

            // JSON5 reports error at line where it fails to parse, but the actual problem might be earlier
            // Look backwards from the error line to find the actual problematic syntax
            let problemLine = actualErrorLine
            let problemContent = lines[actualErrorLine - 1]?.trim() || ""

            // Search backwards for lines that match invalid syntax patterns
            for (let i = actualErrorLine - 1; i >= 0; i--) {
                const lineContent = lines[i]?.trim() || ""
                if (lineContent === '""' || lineContent.match(/^"[^"]*"\s*$/)) {
                    problemLine = i + 1
                    problemContent = lineContent
                    break
                }
            }

            // console.log(
            //     `🔧 [validateWithJSON5] Found problem at line ${problemLine}: "${problemContent}"`,
            // )

            // Check if we found a problematic syntax line
            if (problemContent === '""' || problemContent.match(/^"[^"]*"\s*$/)) {
                cleanMessage = "Invalid property syntax - expected 'key': value format"
                // console.log(`🔧 [validateWithJSON5] Detected syntax error on line ${problemLine}`)
                errors.push({
                    id: `json5-syntax-error-${problemLine}`,
                    line: problemLine,
                    message: cleanMessage,
                    type: "syntax",
                    severity: "error",
                })
                return errors
            } else {
                // Check if this is a missing comma error
                // Look for a complete key:value pair followed by another key
                // Find the actual previous non-empty line
                let prevLineIndex = -1
                let prevLineContent = ""
                for (let i = actualErrorLine - 2; i >= 0; i--) {
                    const lineContent = lines[i]?.trim() || ""
                    if (lineContent !== "") {
                        prevLineIndex = i + 1
                        prevLineContent = lineContent
                        break
                    }
                }

                // console.log(
                //     `🔧 [validateWithJSON5] Checking missing comma: prev line ${prevLineIndex}: "${prevLineContent}", current line ${actualErrorLine}: "${problemContent}"`,
                // )

                if (prevLineContent.match(/^"[^"]*":\s*.+$/) && problemContent.match(/^"[^"]*":/)) {
                    // Previous line has complete key:value, current line starts new key - missing comma
                    cleanMessage = `Missing comma after property on line ${prevLineIndex}`
                    // console.log(
                    //     `🔧 [validateWithJSON5] Detected missing comma after line ${prevLineIndex}`,
                    // )
                    // Return single error for the line that should have the comma
                    errors.push({
                        id: `json5-missing-comma-${prevLineIndex}`,
                        line: prevLineIndex,
                        message: cleanMessage,
                        type: "syntax",
                        severity: "error",
                    })
                    return errors
                }
                // Look backwards to find unclosed structures
                let foundUnclosedArray = false
                let foundUnclosedObject = false
                let unclosedLine = actualErrorLine

                for (let i = actualErrorLine - 2; i >= 0; i--) {
                    const line = lines[i].trim()
                    if (line.includes("[") && !line.includes("]")) {
                        foundUnclosedArray = true
                        unclosedLine = i + 1
                        break
                    } else if (line.includes("{") && !line.includes("}")) {
                        foundUnclosedObject = true
                        unclosedLine = i + 1
                        break
                    }
                }

                if (foundUnclosedArray) {
                    cleanMessage = `Unclosed array starting at line ${unclosedLine} - missing closing bracket ']'`

                    // Create errors for the entire incomplete array block
                    const blockErrors: ErrorInfo[] = []

                    // Start from the unclosed array line
                    for (let i = unclosedLine - 1; i < actualErrorLine - 1; i++) {
                        const lineContent = lines[i]?.trim() || ""

                        if (lines[i] && lineContent !== "") {
                            blockErrors.push({
                                id: `json5-array-block-${unclosedLine}-${i + 1}`,
                                line: i + 1,
                                message: cleanMessage,
                                type: "structural",
                                severity: "error",
                            })
                        }
                    }

                    return blockErrors
                } else if (foundUnclosedObject) {
                    cleanMessage = `Unclosed object starting at line ${unclosedLine} - missing closing brace '}'`

                    // Create errors for the entire incomplete object block
                    const blockErrors: ErrorInfo[] = []

                    // Start from the unclosed object line
                    for (let i = unclosedLine - 1; i < actualErrorLine - 1; i++) {
                        if (lines[i] && lines[i].trim() !== "") {
                            blockErrors.push({
                                id: `json5-object-block-${unclosedLine}-${i + 1}`,
                                line: i + 1,
                                message: cleanMessage,
                                type: "structural",
                                severity: "error",
                            })
                        }
                    }

                    return blockErrors
                } else {
                    cleanMessage = "Invalid JSON syntax - check for missing commas or brackets"
                }
            }
        } else if (error.message.includes("Unexpected token")) {
            const tokenMatch = error.message.match(/Unexpected token (.+?) in JSON/)
            if (tokenMatch) {
                const token = tokenMatch[1]
                if (token === "}") {
                    cleanMessage =
                        "Unexpected closing brace - check for missing comma or incomplete array"
                } else if (token === "]") {
                    cleanMessage =
                        "Unexpected closing bracket - check for missing comma or incomplete object"
                } else {
                    cleanMessage = `Unexpected character '${token}' - check JSON syntax`
                }
            }
        } else if (error.message.includes("Expected")) {
            cleanMessage = error.message.replace(/JSON5?/, "JSON")
        }

        errors.push({
            id: `json5-error-${actualErrorLine}`,
            line: actualErrorLine,
            message: cleanMessage,
            type: "structural",
            severity: "error",
        })

        return errors
    }
}

/**
 * Validates bracket matching and returns bracket errors.
 * Uses improved logic from UnclosedBracketPlugin for better error detection.
 * @param textContent - The text content to validate
 * @returns Array of bracket validation errors
 */
export function validateBrackets(textContent: string): ErrorInfo[] {
    const errors: ErrorInfo[] = []
    const stack: {type: string; line: number; position: number}[] = []
    const lines = textContent.split("\n")

    // console.log(`🔧 [validateBrackets] Starting bracket validation:`, {
    //     textLength: textContent.length,
    //     lines: lines.length,
    // })

    // Process each character to find brackets
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex]
        const lineNumber = lineIndex + 1

        for (let charIndex = 0; charIndex < line.length; charIndex++) {
            const char = line[charIndex]

            if (char === "{" || char === "[" || char === "(") {
                stack.push({
                    type: char,
                    line: lineNumber,
                    position: charIndex,
                })
            } else if (char === "}" || char === "]" || char === ")") {
                const expected = char === "}" ? "{" : char === "]" ? "[" : "("

                if (stack.length === 0) {
                    errors.push({
                        id: `unmatched-closing-${lineNumber}-${charIndex}`,
                        message: `Unmatched closing bracket '${char}'`,
                        line: lineNumber,
                        column: charIndex + 1,
                        type: "bracket",
                        severity: "error",
                    })
                } else {
                    const last = stack.pop()!
                    if (last.type !== expected) {
                        stack.push(last)

                        const neededClosing =
                            last.type === "{" ? "}" : last.type === "[" ? "]" : ")"
                        const lastContext =
                            last.type === "{"
                                ? "object"
                                : last.type === "["
                                  ? "array"
                                  : "parentheses"
                        const currentContext =
                            char === "}" ? "object" : char === "]" ? "array" : "parentheses"

                        errors.push({
                            id: `mismatched-bracket-${lineNumber}-${charIndex}`,
                            message: `Mismatched bracket: expected '${neededClosing}' to close ${lastContext} from line ${last.line}, but found '${char}' (${currentContext} closing)`,
                            line: lineNumber,
                            column: charIndex + 1,
                            type: "bracket",
                            severity: "error",
                        })
                    }
                }
            }
        }
    }

    // Check for unclosed brackets and create block-level errors
    // console.log(`🔍 [validateBrackets] Unclosed brackets in stack:`, {
    //     stackSize: stack.length,
    //     unclosedBrackets: stack.map((item) => `${item.type} at line ${item.line}`),
    // })

    for (const unclosed of stack) {
        const closingChar = unclosed.type === "{" ? "}" : unclosed.type === "[" ? "]" : ")"
        const contextType =
            unclosed.type === "{" ? "object" : unclosed.type === "[" ? "array" : "parentheses"

        // console.log(`⚠️ [validateBrackets] Found unclosed bracket:`, {
        //     type: unclosed.type,
        //     line: unclosed.line,
        //     expectedClosing: closingChar,
        //     context: contextType,
        // })

        // Create more specific error messages based on bracket type
        let message: string
        if (unclosed.type === "[") {
            message = `Missing closing bracket ']' for array started on line ${unclosed.line}`
        } else if (unclosed.type === "{") {
            message = `Missing closing bracket '}' for object started on line ${unclosed.line}`
        } else {
            message = `Missing closing bracket '${closingChar}' for '${unclosed.type}' started on line ${unclosed.line}`
        }

        // Create smart block-level errors for better highlighting
        // For arrays and objects, highlight only the logical unclosed block
        if (unclosed.type === "[" || unclosed.type === "{") {
            const startLine = unclosed.line

            // Find the logical end of this block by looking for the next sibling property
            // or the next closing bracket at the same nesting level
            let endLine = startLine
            let nestingLevel = 1 // Start at 1 since we're inside the opening bracket
            let foundLogicalEnd = false

            for (let lineIndex = startLine; lineIndex < lines.length; lineIndex++) {
                const currentLine = lines[lineIndex].trim()
                const currentLineNum = lineIndex + 1

                // Skip the opening line itself
                if (currentLineNum === startLine) {
                    endLine = currentLineNum
                    continue
                }

                // Count nesting level changes
                for (const char of currentLine) {
                    if (char === unclosed.type) {
                        nestingLevel++
                    } else if (
                        (unclosed.type === "[" && char === "]") ||
                        (unclosed.type === "{" && char === "}")
                    ) {
                        nestingLevel--
                        if (nestingLevel === 0) {
                            // Found the closing bracket for this block
                            foundLogicalEnd = true
                            endLine = currentLineNum
                            break
                        }
                    }
                }

                if (foundLogicalEnd) break

                // If we're back at nesting level 1 and see a property, this is the logical end
                if (nestingLevel === 1 && currentLineNum > startLine) {
                    const propertyMatch = currentLine.match(/^"[^"]*"\s*:/)
                    // console.log(`🔍 [validateBrackets] Line ${currentLineNum} check:`, {
                    //     line: currentLine,
                    //     nestingLevel,
                    //     propertyMatch: !!propertyMatch,
                    //     shouldEnd: !!propertyMatch,
                    // })
                    if (propertyMatch) {
                        // Found next property at same level - end the block before this line
                        // But exclude trailing empty lines
                        let actualEndLine = currentLineNum - 1
                        while (
                            actualEndLine > startLine &&
                            lines[actualEndLine - 1].trim() === ""
                        ) {
                            actualEndLine--
                        }
                        endLine = actualEndLine
                        foundLogicalEnd = true
                        // console.log(
                        //     `🎯 [validateBrackets] Found logical end at line ${currentLineNum}, ending block at ${endLine} (excluding empty lines)`,
                        // )
                        break
                    }
                }

                endLine = currentLineNum
            }

            // Limit the block size to avoid overwhelming errors
            const maxBlockSize = 10
            if (endLine - startLine > maxBlockSize) {
                endLine = startLine + maxBlockSize
            }

            // console.log(`🎯 [validateBrackets] Smart block detection for ${unclosed.type}:`, {
            //     startLine,
            //     endLine,
            //     blockSize: endLine - startLine + 1,
            //     foundLogicalEnd,
            // })

            // Create targeted errors: opening line + logical end line only
            // This reduces noise while still highlighting the unclosed block

            // Always create error for the opening bracket line
            errors.push({
                id: `unclosed-block-${unclosed.line}-start`,
                message: `${message} (opening ${contextType})`,
                line: startLine,
                column: unclosed.position + 1,
                type: "bracket",
                severity: "error",
            })

            // Create error for the logical end line if it's different from start
            if (endLine > startLine && lines[endLine - 1] && lines[endLine - 1].trim() !== "") {
                errors.push({
                    id: `unclosed-block-${unclosed.line}-end`,
                    message: `${message} (last content of unclosed ${contextType})`,
                    line: endLine,
                    column: 1,
                    type: "bracket",
                    severity: "error",
                })
            }
        } else {
            // For parentheses, just highlight the opening line
            errors.push({
                id: `unclosed-bracket-${unclosed.line}-${unclosed.position}`,
                message,
                line: unclosed.line,
                column: unclosed.position + 1,
                type: "bracket",
                severity: "error",
            })
        }
    }

    // console.log(`🔧 [validateBrackets] Bracket validation complete:`, {
    //     totalErrors: errors.length,
    //     errorTypes: errors.map((e) => `${e.type}:${e.line}:${e.message.substring(0, 30)}`),
    // })

    return errors
}

/**
 * Validates content against a JSON schema and returns schema errors.
 * @param textContent - The text content to validate
 * @param schema - The JSON schema to validate against (optional)
 * @returns Array of schema validation errors
 */
export function validateSchema(textContent: string, schema?: any): ErrorInfo[] {
    try {
        // console.log(`🔍 [validateSchema] Schema validation called:`, {
        //     hasSchema: !!schema,
        //     schemaType: schema?.type,
        //     schemaRequired: schema?.required,
        //     textLength: textContent.length,
        // })

        // Skip schema validation if no schema provided or if JSON is invalid
        if (!schema) {
            // console.log(`⚠️ [validateSchema] No schema provided, skipping validation`)
            return []
        }

        let parsedContent: any

        try {
            // First try to parse the original JSON
            const parsedContent = JSON5.parse(textContent)
            // console.log(`🧪 [validateSchema] Parsed JSON successfully:`, parsedContent)
            return validateParsedContent(parsedContent, schema, textContent)
        } catch (originalError: any) {
            // console.log(`🔧 [validateSchema] Original JSON parse failed, trying completion:`, {
            //     error: originalError.message,
            //     textPreview: textContent.substring(0, 100),
            // })

            // Try to complete the JSON for schema validation
            try {
                let completedJson = textContent.trim()
                // console.log(`🔧 [validateSchema] Starting completion with:`, {
                //     original: completedJson.substring(0, 100),
                // })

                // console.log(`🔧 [validateSchema] Before completion:`, {
                //     text: completedJson
                //         .substring(0, 100)
                //         .replace(/\n/g, "\\n")
                //         .replace(/\t/g, "\\t"),
                // })

                // 1. Fix incomplete keys (including empty strings) like "" or "key" -> "key": "placeholder"
                completedJson = completedJson.replace(
                    /"([^"]*)"\s*(?=\n\s*")/g,
                    '"$1": "placeholder"',
                )

                // 2. Fix incomplete key:value pairs like "key": -> "key": "placeholder"
                completedJson = completedJson.replace(
                    /"([^"]+)":\s*(?=\n|$)/g,
                    '"$1": "placeholder"',
                )

                // 3. Fix missing commas: "value" (newline) "key" -> "value", (newline) "key"
                // Also handle arrays and objects: ] (newline) "key" -> ], (newline) "key"
                completedJson = completedJson.replace(
                    /("[^"]*"|\d+|true|false|null|\]|\})\s*\n\s*(?=")/g,
                    "$1,\n\t",
                )

                // Count and balance braces/brackets
                const openBraces = (completedJson.match(/{/g) || []).length
                const closeBraces = (completedJson.match(/}/g) || []).length
                const openBrackets = (completedJson.match(/\[/g) || []).length
                const closeBrackets = (completedJson.match(/\]/g) || []).length

                // Add missing closing braces
                for (let i = 0; i < openBraces - closeBraces; i++) {
                    completedJson += "}"
                }

                // Add missing closing brackets
                for (let i = 0; i < openBrackets - closeBrackets; i++) {
                    completedJson += "]"
                }

                // console.log(`🔧 [validateSchema] After completion:`, {
                //     original: textContent.substring(0, 50),
                //     completed: completedJson.substring(0, 50),
                //     changes: completedJson !== textContent.trim(),
                // })

                parsedContent = JSON5.parse(completedJson)
                // console.log(`🔧 [validateSchema] Parsed completed JSON for schema validation:`, {
                //     original: textContent.substring(0, 50),
                //     completed: completedJson.substring(0, 50),
                // })
            } catch (completionError) {
                // If even completion fails, skip schema validation
                // console.log(
                //     `⚠️ [validateSchema] Could not parse JSON for schema validation, skipping`,
                // )
                return []
            }
        }

        return validateParsedContent(parsedContent, schema, textContent)
    } catch (error) {
        console.error(`🚨 [validateSchema] Unexpected error:`, error)
        return []
    }
}

function validateParsedContent(parsedContent: any, schema: any, textContent: string): ErrorInfo[] {
    const errors: ErrorInfo[] = []

    // console.log(`🧪 [validateSchema] Ready for schema validation:`, {
    //     contentType: typeof parsedContent,
    //     schemaType: schema.type,
    //     isObject: typeof parsedContent === "object",
    // })

    // Basic schema validation (can be enhanced with a proper JSON schema validator)
    if (schema.type === "object" && typeof parsedContent !== "object") {
        // console.log(`❌ [validateSchema] Type mismatch detected`)
        errors.push({
            id: "schema-type-mismatch",
            message: `Expected object but got ${typeof parsedContent}`,
            line: 1,
            type: "schema",
            severity: "error",
        })
    }

    // Check for missing required properties
    if (schema.required && Array.isArray(schema.required)) {
        // console.log(`🔍 [validateSchema] Checking required properties:`, schema.required)
        for (const requiredProp of schema.required) {
            if (!(requiredProp in parsedContent)) {
                // console.log(`❌ [validateSchema] Missing required property: ${requiredProp}`)
                errors.push({
                    id: `schema-missing-${requiredProp}`,
                    message: `Missing required property: "${requiredProp}"`,
                    line: 1, // Could be improved to find the best insertion point
                    type: "schema",
                    severity: "warning", // Use warning instead of error to be less intrusive
                })
            }
        }
    }

    // Check property types
    if (schema.properties && typeof schema.properties === "object") {
        for (const [propName, propSchema] of Object.entries(schema.properties)) {
            if (propName in parsedContent) {
                const propValue = parsedContent[propName]
                const propType = typeof propValue
                const expectedType = (propSchema as any)?.type

                if (expectedType && propType !== expectedType) {
                    // Find the actual line number of this property in the text
                    const lines = textContent.split("\n")
                    let propertyLine = 1

                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i]
                        // Look for the property name in quotes
                        if (line.includes(`"${propName}"`)) {
                            propertyLine = i + 1
                            break
                        }
                    }

                    // console.log(`❌ [validateSchema] Type mismatch for property "${propName}":`, {
                    //     expected: expectedType,
                    //     actual: propType,
                    //     value: propValue,
                    //     foundOnLine: propertyLine,
                    // })

                    errors.push({
                        id: `schema-type-${propName}`,
                        message: `Property "${propName}" should be ${expectedType} but got ${propType}`,
                        line: propertyLine,
                        type: "schema",
                        severity: "error",
                    })
                }
            }
        }
    }

    // Additional schema validation logic can be added here

    return errors
}

/**
 * Combines all validation functions and returns a unified error result.
 * @param textContent - The text content to validate
 * @param schema - Optional JSON schema for validation
 * @returns Combined validation results
 */
export function validateAll(
    textContent: string,
    schema?: any,
    editedLineContent?: string,
    cleanedToOriginalLineMap?: Map<number, number>,
): {
    allErrors: ErrorInfo[]
    errorsByLine: Map<number, ErrorInfo[]>
    structuralErrors: ErrorInfo[]
    bracketErrors: ErrorInfo[]
    schemaErrors: ErrorInfo[]
} {
    // console.log(`🚀 [validateAll] Starting validation with:`, {
    //     textLength: textContent.length,
    //     hasSchema: !!schema,
    // })

    // Use JSON5 for clean, UX-focused validation instead of complex bracket tracking
    // Only skip structural validation during active typing, not schema validation
    const json5Errors = validateWithJSON5(textContent, editedLineContent)
    // console.log(`📊 [validateAll] JSON5 errors:`, json5Errors.length)

    // Schema validation always runs - it's independent of typing state
    const schemaErrors = validateSchema(textContent, schema)
    // console.log(`📊 [validateAll] Schema errors:`, schemaErrors.length)

    // Convert cleaned line numbers to original line numbers if mapping is provided
    const convertLineNumbers = (errors: ErrorInfo[]): ErrorInfo[] => {
        if (!cleanedToOriginalLineMap) return errors

        return errors.map((error) => {
            const originalLineNumber = cleanedToOriginalLineMap.get(error.line) || error.line
            // console.log(`🔄 [validateAll] Converting line ${error.line} → ${originalLineNumber}`)
            return {...error, line: originalLineNumber}
        })
    }

    const convertedJson5Errors = convertLineNumbers(json5Errors)
    const convertedSchemaErrors = convertLineNumbers(schemaErrors)

    // For backward compatibility, map JSON5 errors to expected structure
    const structuralErrors = convertedJson5Errors
    const bracketErrors: ErrorInfo[] = [] // No longer needed with JSON5

    const allErrors = [...structuralErrors, ...bracketErrors, ...convertedSchemaErrors]
    const errorsByLine = new Map<number, ErrorInfo[]>()

    // Group errors by line number
    for (const error of allErrors) {
        if (error.line) {
            const lineErrors = errorsByLine.get(error.line) || []
            lineErrors.push(error)
            errorsByLine.set(error.line, lineErrors)
        }
    }

    return {
        allErrors,
        errorsByLine,
        structuralErrors,
        bracketErrors,
        schemaErrors: convertedSchemaErrors,
    }
}
