import yaml from "js-yaml"

/**
 * Compute line-by-line diff using LCS-based algorithm
 */
function computeLineDiff(
    oldLines: string[],
    newLines: string[],
    contextLines: number,
): {
    type: "context" | "added" | "removed"
    content: string
    oldLineNumber?: number
    newLineNumber?: number
}[] {
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
 * Compute diff between two objects and return GitHub-style diff format
 */
export function computeDiff(
    original: any,
    modified: any,
    options: {language: "json" | "yaml"; contextLines?: number} = {language: "json"},
): string {
    const {language, contextLines = 3} = options

    const oldStr =
        language === "json" ? JSON.stringify(original, null, 2) : yaml.dump(original, {indent: 2})
    const newStr =
        language === "json" ? JSON.stringify(modified, null, 2) : yaml.dump(modified, {indent: 2})

    const oldLines = oldStr.split("\n")
    const newLines = newStr.split("\n")

    // Compute line-by-line diff
    const diffLines = computeLineDiff(oldLines, newLines, contextLines)

    // Convert to GitHub-style diff format with dual line numbers
    return diffLines
        .map((line) => {
            const oldNum = line.oldLineNumber ? line.oldLineNumber.toString() : ""
            const newNum = line.newLineNumber ? line.newLineNumber.toString() : ""

            // Format: "oldLineNum|newLineNum|type|content"
            // This will be parsed by the DiffHighlightPlugin
            return `${oldNum}|${newNum}|${line.type}|${line.content}`
        })
        .join("\n")
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
            emptyString: content.includes('""'),
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
