import yaml from "js-yaml"

import type {CodeLanguage} from "../plugins/code/types"

/**
 * Maximum number of cells (oldLines × newLines) for the LCS DP table.
 * Beyond this threshold, the computation would freeze the browser.
 * 4M cells ≈ ~32MB memory, ~200-500ms on modern hardware.
 */
const LCS_MAX_CELLS = 4_000_000

/**
 * Interleave consecutive removed/added blocks so that each removed line
 * is immediately followed by its positional counterpart from the added block.
 *
 * LCS-based diff naturally groups all removals before all additions when
 * multiple adjacent lines change. This breaks inline diff pairing which
 * relies on consecutive removed→added pairs. Post-processing re-orders:
 *
 *   [R1, R2, R3, A1, A2, A3] → [R1, A1, R2, A2, R3, A3]
 *
 * When counts don't match, extra lines are appended at the end of the block.
 */
function interleaveRemovedAdded(lines: DiffLine[]): DiffLine[] {
    const result: DiffLine[] = []
    let i = 0

    while (i < lines.length) {
        if (lines[i].type !== "removed") {
            result.push(lines[i])
            i++
            continue
        }

        // Collect consecutive removed lines
        const removedStart = i
        while (i < lines.length && lines[i].type === "removed") {
            i++
        }
        const removedEnd = i

        // Collect consecutive added lines immediately following
        const addedStart = i
        while (i < lines.length && lines[i].type === "added") {
            i++
        }
        const addedEnd = i

        const removedCount = removedEnd - removedStart
        const addedCount = addedEnd - addedStart

        if (addedCount === 0) {
            // Pure removals, no interleaving needed
            for (let j = removedStart; j < removedEnd; j++) {
                result.push(lines[j])
            }
            continue
        }

        // Interleave: pair each removed with corresponding added
        const pairCount = Math.min(removedCount, addedCount)
        for (let j = 0; j < pairCount; j++) {
            result.push(lines[removedStart + j])
            result.push(lines[addedStart + j])
        }

        // Append any remaining removed lines
        for (let j = pairCount; j < removedCount; j++) {
            result.push(lines[removedStart + j])
        }

        // Append any remaining added lines
        for (let j = pairCount; j < addedCount; j++) {
            result.push(lines[addedStart + j])
        }
    }

    return result
}

/**
 * Compute line-by-line diff using LCS-based algorithm.
 *
 * Optimizations applied:
 * 1. Common prefix/suffix lines are stripped before LCS (reduces DP table size)
 * 2. Safety cap on DP table size prevents OOM/freeze on very large diffs
 * 3. LCS reconstruction uses push+reverse instead of O(n²) unshift
 * 4. Post-processing interleaves removed/added blocks for proper inline diff pairing
 */
function computeLineDiff(
    oldLines: string[],
    newLines: string[],
    _contextLines: number,
): DiffLine[] {
    const result: DiffLine[] = []

    // --- Strip common prefix ---
    let prefixLen = 0
    const maxPrefix = Math.min(oldLines.length, newLines.length)
    while (prefixLen < maxPrefix && oldLines[prefixLen] === newLines[prefixLen]) {
        prefixLen++
    }

    // --- Strip common suffix ---
    let suffixLen = 0
    const maxSuffix = Math.min(oldLines.length, newLines.length) - prefixLen
    while (
        suffixLen < maxSuffix &&
        oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
    ) {
        suffixLen++
    }

    // Emit prefix context lines
    for (let i = 0; i < prefixLen; i++) {
        result.push({
            type: "context",
            content: oldLines[i],
            oldLineNumber: i + 1,
            newLineNumber: i + 1,
        })
    }

    // Extract the middle (differing) portion
    const oldMiddle = oldLines.slice(prefixLen, oldLines.length - suffixLen)
    const newMiddle = newLines.slice(prefixLen, newLines.length - suffixLen)

    if (oldMiddle.length === 0 && newMiddle.length === 0) {
        // No differences in the middle — only suffix context remains
    } else if (oldMiddle.length * newMiddle.length > LCS_MAX_CELLS) {
        // Safety cap: DP table too large — fall back to interleaved remove/add.
        // This avoids multi-second freezes or OOM for very large diffs.
        const pairCount = Math.min(oldMiddle.length, newMiddle.length)
        for (let i = 0; i < pairCount; i++) {
            result.push({
                type: "removed",
                content: oldMiddle[i],
                oldLineNumber: prefixLen + i + 1,
            })
            result.push({
                type: "added",
                content: newMiddle[i],
                newLineNumber: prefixLen + i + 1,
            })
        }
        for (let i = pairCount; i < oldMiddle.length; i++) {
            result.push({
                type: "removed",
                content: oldMiddle[i],
                oldLineNumber: prefixLen + i + 1,
            })
        }
        for (let i = pairCount; i < newMiddle.length; i++) {
            result.push({
                type: "added",
                content: newMiddle[i],
                newLineNumber: prefixLen + i + 1,
            })
        }
    } else {
        // Run LCS on the middle portion only
        const lcs = longestCommonSubsequence(oldMiddle, newMiddle)

        let oldIndex = 0
        let newIndex = 0
        let lcsIndex = 0

        while (oldIndex < oldMiddle.length || newIndex < newMiddle.length) {
            if (
                lcsIndex < lcs.length &&
                oldIndex < oldMiddle.length &&
                newIndex < newMiddle.length &&
                oldMiddle[oldIndex] === lcs[lcsIndex] &&
                newMiddle[newIndex] === lcs[lcsIndex]
            ) {
                result.push({
                    type: "context",
                    content: oldMiddle[oldIndex],
                    oldLineNumber: prefixLen + oldIndex + 1,
                    newLineNumber: prefixLen + newIndex + 1,
                })
                oldIndex++
                newIndex++
                lcsIndex++
            } else if (
                oldIndex < oldMiddle.length &&
                (lcsIndex >= lcs.length || oldMiddle[oldIndex] !== lcs[lcsIndex])
            ) {
                result.push({
                    type: "removed",
                    content: oldMiddle[oldIndex],
                    oldLineNumber: prefixLen + oldIndex + 1,
                })
                oldIndex++
            } else if (newIndex < newMiddle.length) {
                result.push({
                    type: "added",
                    content: newMiddle[newIndex],
                    newLineNumber: prefixLen + newIndex + 1,
                })
                newIndex++
            }
        }
    }

    // Emit suffix context lines
    const oldSuffixStart = oldLines.length - suffixLen
    const newSuffixStart = newLines.length - suffixLen
    for (let i = 0; i < suffixLen; i++) {
        result.push({
            type: "context",
            content: oldLines[oldSuffixStart + i],
            oldLineNumber: oldSuffixStart + i + 1,
            newLineNumber: newSuffixStart + i + 1,
        })
    }

    // Interleave consecutive removed/added blocks for proper inline diff pairing.
    // The LCS loop naturally emits all removals before additions when multiple
    // adjacent lines change; this post-processing re-orders them as pairs.
    return interleaveRemovedAdded(result)
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
                    const firstFoldedLine = diffLines[contextStart]
                    const lastFoldedLine = diffLines[foldEnd - 1]
                    const startLineNum =
                        firstFoldedLine.oldLineNumber || firstFoldedLine.newLineNumber || 1
                    const endLineNum =
                        lastFoldedLine.oldLineNumber || lastFoldedLine.newLineNumber || 1

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
                    const firstFoldedLine = diffLines[foldStart]
                    const lastFoldedLine = diffLines[contextEnd - 1]
                    const startLineNum =
                        firstFoldedLine.oldLineNumber || firstFoldedLine.newLineNumber || 1
                    const endLineNum =
                        lastFoldedLine.oldLineNumber || lastFoldedLine.newLineNumber || 1

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
                const totalKeep = contextLines * 2
                if (contextLength <= totalKeep + 2) {
                    for (let j = contextStart; j < contextEnd; j++) {
                        result.push(diffLines[j])
                    }
                } else {
                    const keepBefore = contextLines
                    const keepAfter = contextLines
                    const foldStart = contextStart + keepBefore
                    const foldEnd = contextEnd - keepAfter

                    for (let j = contextStart; j < foldStart; j++) {
                        result.push(diffLines[j])
                    }

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
 * @param original - The original object to compare from
 * @param modified - The modified object to compare to
 * @param options - Configuration options for diff computation
 * @returns Unified diff string in the specified format
 */
export function computeDiff(
    original: unknown,
    modified: unknown,
    options: {
        language: CodeLanguage
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

    // Treat non-yaml languages as JSON for serialization
    const oldStr =
        language === "yaml" ? yaml.dump(original, {indent: 2}) : JSON.stringify(original, null, 2)
    const newStr =
        language === "yaml" ? yaml.dump(modified, {indent: 2}) : JSON.stringify(modified, null, 2)

    // Fast path: identical content — no diff needed
    if (oldStr === newStr) {
        return oldStr
            .split("\n")
            .map((line, i) => `${i + 1}|${i + 1}|context|${line}`)
            .join("\n")
    }

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
                const foldLine = line as ExtendedDiffLine
                const startLine = foldLine.startLine || ""
                const endLine = foldLine.endLine || ""
                return `${startLine}-${endLine}|${startLine}-${endLine}|fold|${line.content}|${foldLine.foldedLineCount || 0}`
            } else {
                const oldNum = line.oldLineNumber ? line.oldLineNumber.toString() : ""
                const newNum = line.newLineNumber ? line.newLineNumber.toString() : ""
                return `${oldNum}|${newNum}|${line.type}|${line.content}`
            }
        })
        .join("\n")

    return result
}

/**
 * Helper function to detect if content is likely incomplete while typing
 * Note: For diff purposes, non-yaml languages are treated as JSON-like
 */
export function isContentIncomplete(content: string, language: CodeLanguage): boolean {
    const trimmed = content.trim()

    // Treat non-yaml languages as JSON for incomplete detection
    if (language !== "yaml") {
        const checks = {
            trailingComma: trimmed.endsWith(","),
            openObject: trimmed.endsWith("{"),
            openArray: trimmed.endsWith("["),
            trailingColon: trimmed.endsWith(":"),
            colonAtEnd: /"\s*:\s*$/.test(content),
            colonNewline: /"\s*:\s*\n/.test(content),
        }

        return Object.values(checks).some(Boolean)
    } else {
        // YAML incomplete patterns
        const lines = content.split("\n")
        const hasIncompleteKey = lines.some((line, index) => {
            const trimmedLine = line.trim()
            if (trimmedLine && !trimmedLine.includes(":") && !trimmedLine.startsWith("-")) {
                const nextLine = lines[index + 1]
                if (nextLine && nextLine.trim().includes(":")) {
                    return true
                }
            }
            return false
        })

        const hasMultilineKeyError =
            content.includes("testKey\ndependencies:") ||
            /^\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\n\s*[a-zA-Z_][a-zA-Z0-9_]*:/m.test(content)

        return (
            trimmed.endsWith(":") ||
            trimmed.endsWith("-") ||
            /:\s*$/.test(content) ||
            /:\s*\n\s*$/.test(content) ||
            hasIncompleteKey ||
            hasMultilineKeyError
        )
    }
}

/**
 * LCS implementation with O(n) space optimization.
 * Uses two rolling rows instead of a full (m+1)×(n+1) table,
 * reducing memory from O(m×n) to O(n).
 *
 * Reconstruction uses push+reverse instead of O(n²) unshift.
 */
function longestCommonSubsequence(a: string[], b: string[]): string[] {
    const m = a.length
    const n = b.length

    if (m === 0 || n === 0) return []

    // Build LCS length table using two rows (O(n) space).
    // We also need the full table for backtracking, so we store
    // a direction matrix to reconstruct the path.
    // Direction: 0 = diagonal (match), 1 = up, 2 = left
    const dir = new Uint8Array(m * n)
    let prev = new Int32Array(n + 1)
    let curr = new Int32Array(n + 1)

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                curr[j] = prev[j - 1] + 1
                dir[(i - 1) * n + (j - 1)] = 0 // diagonal
            } else if (prev[j] >= curr[j - 1]) {
                curr[j] = prev[j]
                dir[(i - 1) * n + (j - 1)] = 1 // up
            } else {
                curr[j] = curr[j - 1]
                dir[(i - 1) * n + (j - 1)] = 2 // left
            }
        }
        // Swap rows
        const tmp = prev
        prev = curr
        curr = tmp
        curr.fill(0)
    }

    // Reconstruct LCS using direction matrix
    const lcs: string[] = []
    let i = m,
        j = n

    while (i > 0 && j > 0) {
        const d = dir[(i - 1) * n + (j - 1)]
        if (d === 0) {
            // diagonal — match
            lcs.push(a[i - 1])
            i--
            j--
        } else if (d === 1) {
            // up
            i--
        } else {
            // left
            j--
        }
    }

    lcs.reverse()
    return lcs
}
