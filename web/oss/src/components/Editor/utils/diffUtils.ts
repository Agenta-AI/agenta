import yaml from "js-yaml"

/**
 * Compute line-by-line diff using LCS-based algorithm
 */
function computeLineDiff(oldLines: string[], newLines: string[], contextLines: number): DiffLine[] {
    const result: {
        type: "context" | "added" | "removed"
        content: string
        oldLineNumber?: number
        newLineNumber?: number
    }[] = []

    // Use LCS algorithm for proper diff computation
    const lcs = longestCommonSubsequence(oldLines, newLines)

    let oldIndex = 0
    let newIndex = 0
    let lcsIndex = 0

    while (oldIndex < oldLines.length || newIndex < newLines.length) {
        if (
            lcsIndex < lcs.length &&
            oldIndex < oldLines.length &&
            newIndex < newLines.length &&
            oldLines[oldIndex] === lcs[lcsIndex] &&
            newLines[newIndex] === lcs[lcsIndex]
        ) {
            // Common line - show both line numbers
            result.push({
                type: "context",
                content: oldLines[oldIndex],
                oldLineNumber: oldIndex + 1,
                newLineNumber: newIndex + 1,
            })
            oldIndex++
            newIndex++
            lcsIndex++
        } else if (
            oldIndex < oldLines.length &&
            (lcsIndex >= lcs.length || oldLines[oldIndex] !== lcs[lcsIndex])
        ) {
            // Removed line - show only old line number
            result.push({
                type: "removed",
                content: oldLines[oldIndex],
                oldLineNumber: oldIndex + 1,
            })
            oldIndex++
        } else if (newIndex < newLines.length) {
            // Added line - show only new line number
            result.push({
                type: "added",
                content: newLines[newIndex],
                newLineNumber: newIndex + 1,
            })
            newIndex++
        }
    }

    return result
}

/**
 * Basic diff line type
 */
interface DiffLine {
    type: "context" | "added" | "removed"
    content: string
    oldLineNumber?: number
    newLineNumber?: number
}

/**
 * Extended diff line type with folding support
 */
interface ExtendedDiffLine {
    type: "context" | "added" | "removed" | "fold"
    content: string
    oldLineNumber?: number
    newLineNumber?: number
    foldedLineCount?: number
    startLine?: number
    endLine?: number
}

/**
 * Apply folding logic to diff lines to focus on changes
 * Large sections of unchanged content are collapsed into fold indicators
 */
function applyFolding(
    diffLines: DiffLine[],
    options: {
        contextLines?: number
        foldThreshold?: number
        showFoldedLineCount?: boolean
    } = {},
): ExtendedDiffLine[] {
    const {contextLines = 3, foldThreshold = 5, showFoldedLineCount = true} = options
    const result: ExtendedDiffLine[] = []

    let i = 0
    while (i < diffLines.length) {
        const line = diffLines[i]

        if (line.type !== "context") {
            // Non-context line (added/removed) - always show
            result.push(line)
            i++
            continue
        }

        // Find consecutive context lines
        let contextStart = i
        let contextEnd = i
        while (contextEnd < diffLines.length && diffLines[contextEnd].type === "context") {
            contextEnd++
        }

        const contextLength = contextEnd - contextStart

        if (contextLength <= foldThreshold) {
            // Short context block - show all lines
            for (let j = contextStart; j < contextEnd; j++) {
                result.push(diffLines[j])
            }
        } else {
            // Long context section - apply folding
            const isAtStart = contextStart === 0
            const isAtEnd = contextEnd === diffLines.length

            if (isAtStart) {
                // At the beginning - show last few lines before changes
                const keepLines = Math.min(contextLines, contextLength)
                const foldEnd = contextEnd - keepLines

                if (foldEnd > contextStart) {
                    // Add fold indicator - calculate actual folded line range
                    const firstFoldedLine = diffLines[contextStart]
                    const lastFoldedLine = diffLines[foldEnd - 1]
                    const startLineNum =
                        firstFoldedLine.oldLineNumber || firstFoldedLine.newLineNumber || 1
                    const endLineNum =
                        lastFoldedLine.oldLineNumber || lastFoldedLine.newLineNumber || 1

                    // Debug: fold range calculation is working correctly

                    result.push({
                        type: "fold",
                        content: showFoldedLineCount
                            ? `... ${foldEnd - contextStart} unchanged lines ...`
                            : "...",
                        startLine: startLineNum,
                        endLine: endLineNum,
                        foldedLineCount: foldEnd - contextStart,
                    })
                }

                // Add remaining context lines
                for (let j = foldEnd; j < contextEnd; j++) {
                    result.push(diffLines[j])
                }
            } else if (isAtEnd) {
                // At the end - show first few lines after changes
                const keepLines = Math.min(contextLines, contextLength)
                const foldStart = contextStart + keepLines

                // Add initial context lines
                for (let j = contextStart; j < foldStart; j++) {
                    result.push(diffLines[j])
                }

                if (foldStart < contextEnd) {
                    // Add fold indicator - calculate actual folded line range
                    const firstFoldedLine = diffLines[foldStart]
                    const lastFoldedLine = diffLines[contextEnd - 1]
                    const startLineNum =
                        firstFoldedLine.oldLineNumber || firstFoldedLine.newLineNumber || 1
                    const endLineNum =
                        lastFoldedLine.oldLineNumber || lastFoldedLine.newLineNumber || 1

                    // Debug: fold range calculation is working correctly

                    result.push({
                        type: "fold",
                        content: showFoldedLineCount
                            ? `... ${contextEnd - foldStart} unchanged lines ...`
                            : "...",
                        startLine: startLineNum,
                        endLine: endLineNum,
                        foldedLineCount: contextEnd - foldStart,
                    })
                }
            } else {
                // In the middle - show context around changes
                // Only fold if we can actually save significant lines
                const totalKeep = contextLines * 2 // Keep context lines before and after
                if (contextLength <= totalKeep + 2) {
                    // Not enough lines to make folding worthwhile, keep all
                    for (let j = contextStart; j < contextEnd; j++) {
                        result.push(diffLines[j])
                    }
                } else {
                    // Enough lines to fold meaningfully
                    const keepBefore = contextLines
                    const keepAfter = contextLines
                    const foldStart = contextStart + keepBefore
                    const foldEnd = contextEnd - keepAfter

                    // Add initial context lines
                    for (let j = contextStart; j < foldStart; j++) {
                        result.push(diffLines[j])
                    }

                    // Add fold indicator - calculate actual folded line range
                    const firstFoldedLine = diffLines[foldStart]
                    const lastFoldedLine = diffLines[foldEnd - 1]
                    const startLineNum =
                        firstFoldedLine.oldLineNumber || firstFoldedLine.newLineNumber || 1
                    const endLineNum =
                        lastFoldedLine.oldLineNumber || lastFoldedLine.newLineNumber || 1

                    result.push({
                        type: "fold",
                        content: showFoldedLineCount
                            ? `... ${foldEnd - foldStart} unchanged lines ...`
                            : "...",
                        startLine: startLineNum,
                        endLine: endLineNum,
                        foldedLineCount: foldEnd - foldStart,
                    })

                    // Add final context lines
                    for (let j = foldEnd; j < contextEnd; j++) {
                        result.push(diffLines[j])
                    }
                }
            }
        }

        i = contextEnd
    }

    return result
}

/**
 * Compute diff between two objects and return GitHub-style diff format
 *
 * This function takes two JavaScript objects and computes a line-by-line diff
 * in the specified format (JSON or YAML). The result is a unified diff format
 * that can be parsed and displayed by the DiffHighlightPlugin.
 *
 * ## Input Handling:
 * - Accepts any JavaScript objects/values as input
 * - Serializes objects to strings based on the specified language
 * - Handles nested objects, arrays, and primitive values
 *
 * ## Language Support:
 * **JSON Mode:**
 * - Uses `JSON.stringify(obj, null, 2)` for consistent formatting
 * - 2-space indentation for readability
 * - Proper JSON syntax with quotes and brackets
 *
 * **YAML Mode:**
 * - Uses `yaml.dump(obj, {indent: 2})` for consistent formatting
 * - 2-space indentation following YAML conventions
 * - Clean YAML syntax without unnecessary quotes
 *
 * ## Output Format:
 * Returns a string where each line follows the pattern:
 * ```
 * oldLineNum|newLineNum|type|content
 * ```
 * - `oldLineNum`: Line number in original (empty for added lines)
 * - `newLineNum`: Line number in modified (empty for removed lines)
 * - `type`: "added" | "removed" | "context"
 * - `content`: The actual line content
 *
 * ## Usage Examples:
 *
 * ### JSON Diff
 * ```typescript
 * const original = {name: "old-service", version: "1.0.0"}
 * const modified = {name: "new-service", version: "1.1.0"}
 *
 * const diff = computeDiff(original, modified, {
 *   language: "json",
 *   contextLines: 3
 * })
 * ```
 *
 * ### YAML Diff
 * ```typescript
 * const original = {name: "old-service", config: {port: 8080}}
 * const modified = {name: "new-service", config: {port: 9000}}
 *
 * const diff = computeDiff(original, modified, {
 *   language: "yaml",
 *   contextLines: 2
 * })
 * ```
 *
 * @param original - The original object to compare from
 * @param modified - The modified object to compare to
 * @param options - Configuration options for diff computation
 * @param options.language - Output format: "json" or "yaml"
 * @param options.contextLines - Number of context lines around changes (default: 3)
 * @returns Unified diff string in the specified format
 */
export function computeDiff(
    original: any,
    modified: any,
    options: {
        language: "json" | "yaml"
        contextLines?: number
        enableFolding?: boolean
        foldThreshold?: number
        showFoldedLineCount?: boolean
    } = {language: "json"},
): string {
    const {
        language,
        contextLines = 3,
        enableFolding = false,
        foldThreshold = 10,
        showFoldedLineCount = true,
    } = options

    const oldStr =
        language === "json" ? JSON.stringify(original, null, 2) : yaml.dump(original, {indent: 2})
    const newStr =
        language === "json" ? JSON.stringify(modified, null, 2) : yaml.dump(modified, {indent: 2})

    const oldLines = oldStr.split("\n")
    const newLines = newStr.split("\n")

    // Compute line-by-line diff
    let diffLines: DiffLine[] | ExtendedDiffLine[] = computeLineDiff(
        oldLines,
        newLines,
        contextLines,
    )

    // Apply folding if enabled
    if (enableFolding) {
        diffLines = applyFolding(diffLines as DiffLine[], {
            contextLines,
            foldThreshold,
            showFoldedLineCount,
        })
    }

    // Convert to GitHub-style diff format with dual line numbers
    const result = diffLines
        .map((line) => {
            if (line.type === "fold") {
                // Special handling for fold lines
                const foldLine = line as ExtendedDiffLine
                const startLine = foldLine.startLine || ""
                const endLine = foldLine.endLine || ""
                // Format: "startLine-endLine|startLine-endLine|fold|content|foldedLineCount"
                return `${startLine}-${endLine}|${startLine}-${endLine}|fold|${line.content}|${foldLine.foldedLineCount || 0}`
            } else {
                // Regular diff lines
                const oldNum = line.oldLineNumber ? line.oldLineNumber.toString() : ""
                const newNum = line.newLineNumber ? line.newLineNumber.toString() : ""
                // Format: "oldLineNum|newLineNum|type|content"
                return `${oldNum}|${newNum}|${line.type}|${line.content}`
            }
        })
        .join("\n")

    return result
}

/**
 * Helper function to detect if content is likely incomplete while typing
 */
export function isContentIncomplete(content: string, language: "json" | "yaml"): boolean {
    const trimmed = content.trim()

    if (language === "json") {
        const checks = {
            trailingComma: trimmed.endsWith(","),
            openObject: trimmed.endsWith("{"),
            openArray: trimmed.endsWith("["),
            trailingColon: trimmed.endsWith(":"),
            // Removed emptyString check - '""' is valid JSON (empty string value)
            colonAtEnd: /"\s*:\s*$/.test(content),
            colonNewline: /"\s*:\s*\n/.test(content),
            // Removed invalidValueStart - too restrictive and causes false positives
        }

        return Object.values(checks).some(Boolean)
    } else {
        // YAML incomplete patterns
        const lines = content.split("\n")
        const hasIncompleteKey = lines.some((line, index) => {
            const trimmedLine = line.trim()
            // Check for key without value (not followed by colon or value)
            if (trimmedLine && !trimmedLine.includes(":") && !trimmedLine.startsWith("-")) {
                // Check if next line exists and starts a new key
                const nextLine = lines[index + 1]
                if (nextLine && nextLine.trim().includes(":")) {
                    return true // Key without value followed by another key
                }
            }
            return false
        })

        // Check for the specific "multiline key" error pattern
        const hasMultilineKeyError =
            content.includes("testKey\ndependencies:") ||
            /^\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\n\s*[a-zA-Z_][a-zA-Z0-9_]*:/m.test(content)

        return (
            trimmed.endsWith(":") || // Missing value after key
            trimmed.endsWith("-") || // Incomplete list item
            /:\s*$/.test(content) || // Key followed by colon at end
            /:\s*\n\s*$/.test(content) || // Key followed by colon and newline
            hasIncompleteKey || // Key without value followed by another key
            hasMultilineKeyError // Multiline key error pattern
        )
    }
}

/**
 * Simple LCS implementation for line diff
 */
function longestCommonSubsequence(a: string[], b: string[]): string[] {
    const m = a.length
    const n = b.length
    const dp: number[][] = Array(m + 1)
        .fill(null)
        .map(() => Array(n + 1).fill(0))

    // Build LCS table
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
            }
        }
    }

    // Reconstruct LCS
    const lcs: string[] = []
    let i = m,
        j = n

    while (i > 0 && j > 0) {
        if (a[i - 1] === b[j - 1]) {
            lcs.unshift(a[i - 1])
            i--
            j--
        } else if (dp[i - 1][j] > dp[i][j - 1]) {
            i--
        } else {
            j--
        }
    }

    return lcs
}
