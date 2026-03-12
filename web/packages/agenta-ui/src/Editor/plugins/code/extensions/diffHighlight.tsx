/**
 * diffHighlight.tsx
 *
 * Diff highlighting extension for code blocks with support for both JSON and YAML content.
 * Processes original and modified content to generate and display unified diff format
 * with proper syntax highlighting.
 *
 * ## Features:
 * - Automatic detection of diff format lines
 * - Support for unified diff format
 * - JSON and YAML language support
 * - Integration with existing syntax highlighting
 * - Line-by-line diff state management
 * - Real-time diff computation
 * - Inline diff with word-level granularity
 * - Long line truncation with character count indicators
 *
 * ## Architecture:
 * - `registerDiffHighlightBehavior()` — registers the INITIAL_CONTENT_COMMAND handler
 *   and CodeBlockNode transform for diff annotation
 * - `DiffHighlightExtension` — Lexical extension wrapper (used by the extension system)
 * - `DiffHighlightPlugin` — Legacy React component wrapper (backward compatibility)
 *
 * @module DiffHighlight
 */

import {useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import yaml from "js-yaml"
import JSON5 from "json5"
import {
    $addUpdateTag,
    $createTextNode,
    $getRoot,
    $hasUpdateTag,
    COMMAND_PRIORITY_CRITICAL,
    defineExtension,
    TextNode,
    type LexicalEditor,
} from "lexical"

import {
    INITIAL_CONTENT_COMMAND,
    InitialContentPayload,
} from "../../../commands/InitialContentCommand"
import {computeDiff} from "../../../utils/diffUtils"
import {$createCodeBlockNode} from "../nodes/CodeBlockNode"
import {CodeBlockNode} from "../nodes/CodeBlockNode"
import {$createCodeLineNode} from "../nodes/CodeLineNode"
import {CodeLineNode, DiffType} from "../nodes/CodeLineNode"
import {$getAllCodeLines, $wrapLinesInSegments} from "../utils/segmentUtils"

// ─── Types ───────────────────────────────────────────────────────────────────

interface InlineDiffSegment {
    text: string
    changed: boolean
    /** Fine-grained segment type for unified diff and truncation styling */
    segmentType?: "removed" | "added" | "truncated"
}

interface InlineDiffPair {
    removed: InlineDiffSegment[]
    added: InlineDiffSegment[]
    /** Combined segments for single-line unified display (removed strikethrough + added inline) */
    unified: InlineDiffSegment[]
}

interface DiffHighlightPluginProps {
    originalContent?: string
    modifiedContent?: string
    language?: "json" | "yaml"
    enableFolding?: boolean
    foldThreshold?: number
    showFoldedLineCount?: boolean
}

// ─── Diff line parsing ───────────────────────────────────────────────────────

/**
 * Parses a GitHub-style diff line and extracts line numbers and diff type
 * @param lineContent - The text content in format "oldLineNum|newLineNum|type|content"
 * @returns Parsed diff information or null if not a valid diff line
 */
function parseDiffLine(lineContent: string): {
    oldLineNumber?: number
    newLineNumber?: number
    diffType: DiffType
    content: string
} | null {
    // Check if this is our new format: "oldLineNum|newLineNum|type|content" or fold format
    const parts = lineContent.split("|")
    // Parse diff line format

    if (parts.length >= 4) {
        const [oldNumStr, newNumStr, type, ...contentParts] = parts

        if (type === "fold") {
            // Special handling for fold lines: "startLine-endLine|startLine-endLine|fold|content|foldedLineCount"
            const content = contentParts.slice(0, -1).join("|") // All but last part is content
            const _foldedLineCount = parseInt(contentParts[contentParts.length - 1] || "0", 10)

            // For fold lines, we want to display the range as-is
            // The oldNumStr and newNumStr are both "startLine-endLine" format
            // We'll store the start and end as separate numbers for CSS display
            const lineRange = oldNumStr.split("-")
            const startLine = lineRange[0] ? parseInt(lineRange[0], 10) : undefined
            const endLine = lineRange[1] ? parseInt(lineRange[1], 10) : undefined

            return {
                oldLineNumber: startLine,
                newLineNumber: endLine,
                diffType: "fold" as DiffType,
                content,
            }
        } else {
            // Regular diff lines
            const content = contentParts.join("|") // Rejoin in case content had pipes

            const oldLineNumber =
                oldNumStr && oldNumStr.trim() !== "" ? parseInt(oldNumStr, 10) : undefined
            const newLineNumber =
                newNumStr && newNumStr.trim() !== "" ? parseInt(newNumStr, 10) : undefined
            const diffType = type as DiffType

            return {
                oldLineNumber,
                newLineNumber,
                diffType,
                content,
            }
        }
    }

    // Fallback to old format detection
    const trimmed = lineContent.trim()
    if (trimmed.startsWith("+") && !trimmed.startsWith("+++")) {
        // For added lines, remove the + prefix but preserve indentation of the actual content
        const contentWithoutPrefix = lineContent.replace(/^\s*\+/, "")
        return {diffType: "added", content: contentWithoutPrefix}
    }
    if (trimmed.startsWith("-") && !trimmed.startsWith("---")) {
        // For removed lines, remove the - prefix but preserve indentation of the actual content
        const contentWithoutPrefix = lineContent.replace(/^\s*-/, "")
        return {diffType: "removed", content: contentWithoutPrefix}
    }

    // For context lines, preserve the original content with indentation
    return {diffType: "context", content: lineContent}
}

// ─── Inline diff computation ─────────────────────────────────────────────────

function buildInlineDiffPair(removedLine: string, addedLine: string): InlineDiffPair | null {
    if (!removedLine || !addedLine || removedLine === addedLine) return null

    const maxPrefix = Math.min(removedLine.length, addedLine.length)
    let prefixLength = 0
    while (prefixLength < maxPrefix && removedLine[prefixLength] === addedLine[prefixLength]) {
        prefixLength++
    }

    let removedSuffixLength = removedLine.length - 1
    let addedSuffixLength = addedLine.length - 1
    while (
        removedSuffixLength >= prefixLength &&
        addedSuffixLength >= prefixLength &&
        removedLine[removedSuffixLength] === addedLine[addedSuffixLength]
    ) {
        removedSuffixLength--
        addedSuffixLength--
    }

    const removedMiddle = removedLine.slice(prefixLength, removedSuffixLength + 1)
    const addedMiddle = addedLine.slice(prefixLength, addedSuffixLength + 1)
    const unchangedChars = prefixLength + (removedLine.length - 1 - removedSuffixLength)
    const overlapRatio = unchangedChars / Math.max(removedLine.length, addedLine.length)

    // Only apply inline diff for mostly-similar lines; otherwise line-level diff is clearer.
    if (overlapRatio < 0.3) {
        // For long strings with scattered changes, try word-level diff
        // which can identify multiple separate change regions
        if (removedLine.length > 100 || addedLine.length > 100) {
            return buildWordLevelInlineDiff(removedLine, addedLine)
        }
        return null
    }

    const prefix = removedLine.slice(0, prefixLength)
    const suffix = removedLine.slice(removedSuffixLength + 1)

    const toSegments = (
        middleText: string,
        includeChangedSegment: boolean,
    ): InlineDiffSegment[] => {
        const segments: InlineDiffSegment[] = []
        if (prefix) segments.push({text: prefix, changed: false})
        if (includeChangedSegment && middleText) segments.push({text: middleText, changed: true})
        if (suffix) segments.push({text: suffix, changed: false})
        return segments
    }

    // Build unified segments: prefix + removed (strikethrough) + added (highlight) + suffix
    const unified: InlineDiffSegment[] = []
    if (prefix) unified.push({text: prefix, changed: false})
    if (removedMiddle) unified.push({text: removedMiddle, changed: true, segmentType: "removed"})
    if (addedMiddle) unified.push({text: addedMiddle, changed: true, segmentType: "added"})
    if (suffix) unified.push({text: suffix, changed: false})

    return {
        removed: toSegments(removedMiddle, Boolean(removedMiddle)),
        added: toSegments(addedMiddle, Boolean(addedMiddle)),
        unified,
    }
}

// ─── Word-level inline diff ──────────────────────────────────────────────────

/** Maximum DP cells for word-level inline diff (prevents freeze on huge strings) */
const INLINE_DIFF_MAX_CELLS = 2_000_000

/**
 * Tokenize a string into word/whitespace tokens for word-level diff.
 * Lossless: `tokens.join('') === text`.
 */
function tokenizeForInlineDiff(text: string): string[] {
    return text.match(/\S+|\s+/g) || []
}

/**
 * Word-level inline diff for long strings with multiple scattered changes.
 * Uses LCS on word tokens to find all matching/changed regions.
 */
function buildWordLevelInlineDiff(removedLine: string, addedLine: string): InlineDiffPair | null {
    const removedTokens = tokenizeForInlineDiff(removedLine)
    const addedTokens = tokenizeForInlineDiff(addedLine)

    const rLen = removedTokens.length
    const aLen = addedTokens.length

    // Safety cap — too many tokens would freeze the browser
    if (rLen * aLen > INLINE_DIFF_MAX_CELLS) return null

    // Skip matching prefix tokens
    let tokenPrefix = 0
    const maxTokenPrefix = Math.min(rLen, aLen)
    while (
        tokenPrefix < maxTokenPrefix &&
        removedTokens[tokenPrefix] === addedTokens[tokenPrefix]
    ) {
        tokenPrefix++
    }

    // Skip matching suffix tokens
    let tokenSuffix = 0
    const maxTokenSuffix = Math.min(rLen - tokenPrefix, aLen - tokenPrefix)
    while (
        tokenSuffix < maxTokenSuffix &&
        removedTokens[rLen - 1 - tokenSuffix] === addedTokens[aLen - 1 - tokenSuffix]
    ) {
        tokenSuffix++
    }

    const rMiddle = removedTokens.slice(tokenPrefix, rLen - tokenSuffix)
    const aMiddle = addedTokens.slice(tokenPrefix, aLen - tokenSuffix)

    // If no middle difference, lines are identical (shouldn't happen but guard)
    if (rMiddle.length === 0 && aMiddle.length === 0) return null

    // Check DP size for the middle portion only
    if (rMiddle.length * aMiddle.length > INLINE_DIFF_MAX_CELLS) return null

    // Compute LCS on middle tokens using DP
    const rMLen = rMiddle.length
    const aMLen = aMiddle.length
    const dp = new Uint16Array((rMLen + 1) * (aMLen + 1))
    const stride = aMLen + 1

    for (let i = 1; i <= rMLen; i++) {
        for (let j = 1; j <= aMLen; j++) {
            if (rMiddle[i - 1] === aMiddle[j - 1]) {
                dp[i * stride + j] = dp[(i - 1) * stride + (j - 1)] + 1
            } else {
                dp[i * stride + j] = Math.max(dp[(i - 1) * stride + j], dp[i * stride + (j - 1)])
            }
        }
    }

    // Backtrack to find matched token indices in both sequences
    const rMatched = new Uint8Array(rMLen)
    const aMatched = new Uint8Array(aMLen)
    let ri = rMLen,
        ai = aMLen
    while (ri > 0 && ai > 0) {
        if (rMiddle[ri - 1] === aMiddle[ai - 1]) {
            rMatched[ri - 1] = 1
            aMatched[ai - 1] = 1
            ri--
            ai--
        } else if (dp[(ri - 1) * stride + ai] >= dp[ri * stride + (ai - 1)]) {
            ri--
        } else {
            ai--
        }
    }

    // Build segments for a token array given matched flags
    const buildSegments = (
        prefixTokens: string[],
        middleTokens: string[],
        suffixTokens: string[],
        matched: Uint8Array,
    ): InlineDiffSegment[] => {
        const segments: InlineDiffSegment[] = []
        let currentText = ""
        let currentChanged = false

        // Prefix tokens are all unchanged
        const prefixText = prefixTokens.join("")
        if (prefixText) {
            currentText = prefixText
            currentChanged = false
        }

        // Middle tokens — use matched flags
        for (let i = 0; i < middleTokens.length; i++) {
            const isChanged = !matched[i]
            if (i === 0 && !currentText) {
                currentText = middleTokens[i]
                currentChanged = isChanged
            } else if (isChanged === currentChanged) {
                currentText += middleTokens[i]
            } else {
                if (currentText) segments.push({text: currentText, changed: currentChanged})
                currentText = middleTokens[i]
                currentChanged = isChanged
            }
        }

        // Suffix tokens are all unchanged
        const suffixText = suffixTokens.join("")
        if (suffixText) {
            if (!currentChanged && currentText) {
                currentText += suffixText
            } else {
                if (currentText) segments.push({text: currentText, changed: currentChanged})
                currentText = suffixText
                currentChanged = false
            }
        }

        if (currentText) segments.push({text: currentText, changed: currentChanged})
        return segments
    }

    const prefixTokenArr = removedTokens.slice(0, tokenPrefix)
    const rSuffixTokenArr = removedTokens.slice(rLen - tokenSuffix)
    const aSuffixTokenArr = addedTokens.slice(aLen - tokenSuffix)

    const removedSegments = buildSegments(prefixTokenArr, rMiddle, rSuffixTokenArr, rMatched)
    const addedSegments = buildSegments(prefixTokenArr, aMiddle, aSuffixTokenArr, aMatched)

    // Check overlap ratio from the word-level diff
    const rUnchangedChars = removedSegments
        .filter((s) => !s.changed)
        .reduce((sum, s) => sum + s.text.length, 0)
    const wordOverlapRatio = rUnchangedChars / Math.max(removedLine.length, addedLine.length)
    if (wordOverlapRatio < 0.3) return null

    // Build unified segments by walking both token sequences with LCS alignment
    const unified = buildUnifiedFromLCS(
        prefixTokenArr,
        rMiddle,
        aMiddle,
        rSuffixTokenArr,
        rMatched,
        aMatched,
    )

    return {removed: removedSegments, added: addedSegments, unified}
}

/**
 * Build unified (single-line) segments from LCS alignment of two token sequences.
 * Interleaves removed (strikethrough) and added (highlight) tokens between unchanged regions.
 */
function buildUnifiedFromLCS(
    prefixTokens: string[],
    rMiddle: string[],
    aMiddle: string[],
    suffixTokens: string[],
    rMatched: Uint8Array,
    aMatched: Uint8Array,
): InlineDiffSegment[] {
    const raw: InlineDiffSegment[] = []

    // Prefix is unchanged
    const prefixText = prefixTokens.join("")
    if (prefixText) raw.push({text: prefixText, changed: false})

    // Walk both middle sequences in sync using LCS matching
    let ri = 0,
        ai = 0
    while (ri < rMiddle.length || ai < aMiddle.length) {
        // Collect unmatched removed tokens
        let removedText = ""
        while (ri < rMiddle.length && !rMatched[ri]) {
            removedText += rMiddle[ri]
            ri++
        }
        if (removedText) raw.push({text: removedText, changed: true, segmentType: "removed"})

        // Collect unmatched added tokens
        let addedText = ""
        while (ai < aMiddle.length && !aMatched[ai]) {
            addedText += aMiddle[ai]
            ai++
        }
        if (addedText) raw.push({text: addedText, changed: true, segmentType: "added"})

        // Emit matched token (same in both)
        if (ri < rMiddle.length && rMatched[ri] && ai < aMiddle.length && aMatched[ai]) {
            raw.push({text: rMiddle[ri], changed: false})
            ri++
            ai++
        }
    }

    // Suffix is unchanged
    const suffixText = suffixTokens.join("")
    if (suffixText) raw.push({text: suffixText, changed: false})

    // Merge consecutive segments of the same type
    const merged: InlineDiffSegment[] = []
    for (const seg of raw) {
        const prev = merged.length > 0 ? merged[merged.length - 1] : null
        if (prev && prev.changed === seg.changed && prev.segmentType === seg.segmentType) {
            prev.text += seg.text
        } else {
            merged.push({...seg})
        }
    }

    return merged
}

// ─── Truncation utilities ────────────────────────────────────────────────────

/** Maximum line length before truncation kicks in for diff views */
const DIFF_LINE_TRUNCATE_THRESHOLD = 200
/** How many characters of context to keep around a changed segment */
const DIFF_CONTEXT_CHARS = 60

/**
 * Format a character count for display in truncation indicators.
 */
function formatTruncatedCount(count: number): string {
    if (count >= 1000) {
        return `${(count / 1000).toFixed(1)}k`
    }
    return `${count}`
}

/**
 * Build a truncation indicator segment with distinct styling.
 */
function $truncationSegment(hiddenCount: number): InlineDiffSegment {
    return {
        text: ` … [${formatTruncatedCount(hiddenCount)} chars] … `,
        changed: false,
        segmentType: "truncated",
    }
}

/**
 * Truncate a long plain-text line into segments with styled truncation indicators.
 * Returns null if no truncation needed (caller should use plain text).
 */
function $truncateDiffLineToSegments(content: string): InlineDiffSegment[] | null {
    if (content.length <= DIFF_LINE_TRUNCATE_THRESHOLD) return null

    // Find the JSON string value boundary (first quote after a colon)
    // so we truncate the value, not the key
    const colonQuoteMatch = content.match(/^(\s*"[^"]*"\s*:\s*")/)
    if (colonQuoteMatch) {
        const keyPrefix = colonQuoteMatch[1]
        const valueContent = content.slice(keyPrefix.length)
        const keepChars = Math.max(40, DIFF_LINE_TRUNCATE_THRESHOLD - keyPrefix.length)
        if (valueContent.length > keepChars) {
            return [
                {text: keyPrefix + valueContent.slice(0, keepChars), changed: false},
                $truncationSegment(valueContent.length - keepChars),
            ]
        }
    }

    // Fallback: truncate from the end
    return [
        {text: content.slice(0, DIFF_LINE_TRUNCATE_THRESHOLD), changed: false},
        $truncationSegment(content.length - DIFF_LINE_TRUNCATE_THRESHOLD),
    ]
}

/**
 * Truncate long unchanged segments in inline diff.
 * Produces separate styled truncation indicator segments.
 */
function $truncateInlineDiffSegments(segments: InlineDiffSegment[]): InlineDiffSegment[] {
    // Only truncate if total text length exceeds threshold
    const totalLength = segments.reduce((sum, s) => sum + s.text.length, 0)
    if (totalLength <= DIFF_LINE_TRUNCATE_THRESHOLD) return segments

    const result: InlineDiffSegment[] = []

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]

        // Never truncate changed segments or short segments
        if (segment.changed || segment.text.length <= DIFF_CONTEXT_CHARS * 2) {
            result.push(segment)
            continue
        }

        // This is a long unchanged segment — split into content + truncation indicator
        const isFirst = i === 0
        const isLast = i === segments.length - 1
        const hasChangedNeighborBefore = i > 0 && segments[i - 1].changed
        const hasChangedNeighborAfter = i < segments.length - 1 && segments[i + 1].changed

        if (isFirst && !isLast) {
            // Leading unchanged: keep small head + tail near the change
            const hiddenCount = segment.text.length - DIFF_CONTEXT_CHARS - 20
            result.push({text: segment.text.slice(0, 20), changed: false})
            result.push($truncationSegment(hiddenCount))
            result.push({text: segment.text.slice(-DIFF_CONTEXT_CHARS), changed: false})
        } else if (isLast && !isFirst) {
            // Trailing unchanged: keep head near the change
            const hiddenCount = segment.text.length - DIFF_CONTEXT_CHARS
            result.push({text: segment.text.slice(0, DIFF_CONTEXT_CHARS), changed: false})
            result.push($truncationSegment(hiddenCount))
        } else if (hasChangedNeighborBefore || hasChangedNeighborAfter) {
            // Middle segment between two changes: keep both ends
            const hiddenCount = segment.text.length - DIFF_CONTEXT_CHARS * 2
            if (hiddenCount > 20) {
                result.push({text: segment.text.slice(0, DIFF_CONTEXT_CHARS), changed: false})
                result.push($truncationSegment(hiddenCount))
                result.push({text: segment.text.slice(-DIFF_CONTEXT_CHARS), changed: false})
            } else {
                result.push(segment)
            }
        } else {
            // Standalone long unchanged segment
            const hiddenCount = segment.text.length - DIFF_CONTEXT_CHARS
            result.push({text: segment.text.slice(0, DIFF_CONTEXT_CHARS), changed: false})
            result.push($truncationSegment(hiddenCount))
        }
    }

    return result
}

// ─── Segment styling ─────────────────────────────────────────────────────────

/** Inline style constants for diff segment types */
const DIFF_SEGMENT_STYLES = {
    removed:
        "background-color: rgba(220, 38, 38, 0.3); text-decoration: line-through; text-decoration-color: rgba(220, 38, 38, 0.6); border-radius: 2px; padding: 0 1px;",
    added: "background-color: rgba(22, 163, 74, 0.3); border-radius: 2px; padding: 0 1px;",
    truncated: "opacity: 0.45; font-style: italic; color: #888; letter-spacing: 0.02em;",
} as const

function $setLineContentWithInlineDiff(
    lineNode: CodeLineNode,
    fullContent: string,
    diffType: DiffType,
    segments?: InlineDiffSegment[] | null,
) {
    lineNode.clear()

    if (!segments || segments.length === 0) {
        // Try to produce styled truncation segments for plain text
        const truncatedSegs = $truncateDiffLineToSegments(fullContent)
        if (truncatedSegs) {
            truncatedSegs.forEach((seg) => {
                const node = $createTextNode(seg.text).setMode("token")
                if (seg.segmentType === "truncated") {
                    node.setStyle(DIFF_SEGMENT_STYLES.truncated)
                }
                lineNode.append(node)
            })
        } else {
            lineNode.append($createTextNode(fullContent).setMode("token"))
        }
        return
    }

    const truncatedSegments = $truncateInlineDiffSegments(segments)

    truncatedSegments.forEach((segment) => {
        const node = $createTextNode(segment.text).setMode("token")

        if (segment.segmentType === "truncated") {
            node.setStyle(DIFF_SEGMENT_STYLES.truncated)
        } else if (segment.segmentType === "removed") {
            node.setStyle(DIFF_SEGMENT_STYLES.removed)
        } else if (segment.segmentType === "added") {
            node.setStyle(DIFF_SEGMENT_STYLES.added)
        } else if (segment.changed) {
            // Legacy path: use line-level diffType for color
            const changedBg =
                diffType === "added" ? DIFF_SEGMENT_STYLES.added : DIFF_SEGMENT_STYLES.removed
            node.setStyle(changedBg)
        }

        lineNode.append(node)
    })
}

// ─── Diff content detection ──────────────────────────────────────────────────

/**
 * Checks if a code block contains diff content
 * @param blockText - The full text content of the code block
 * @returns True if the block appears to contain diff content
 */
function isDiffContent(blockText: string): boolean {
    const lines = blockText.split("\n")
    let diffLineCount = 0

    for (const line of lines) {
        const parsed = parseDiffLine(line)
        // Check if it's a valid diff line (has diff type other than context or has line numbers)
        if (
            parsed &&
            (parsed.diffType !== "context" || parsed.oldLineNumber || parsed.newLineNumber)
        ) {
            diffLineCount++
        }
    }

    const ratio = diffLineCount / lines.length
    const isDiff = diffLineCount > 0 && ratio > 0.1 // Lower threshold for GitHub-style format

    return isDiff
}

// ─── Diff-built tracking ─────────────────────────────────────────────────────
// Tracks which editors have completed their initial diff DOM build.
// Uses a WeakMap keyed on editor instance so the flag survives React Strict Mode
// double-mounts (where closures are discarded and recreated).
const diffBuiltEditors = new WeakSet<LexicalEditor>()

// ─── Behavior registration ───────────────────────────────────────────────────

export function registerDiffHighlightBehavior(
    editor: LexicalEditor,
    {
        originalContent,
        modifiedContent,
        language = "json",
        enableFolding = false,
        foldThreshold = 5,
        showFoldedLineCount = true,
    }: DiffHighlightPluginProps = {},
): () => void {
    // Reset the diff-built flag for this editor on (re-)registration.
    diffBuiltEditors.delete(editor)

    const removeCommandListener = editor.registerCommand(
        INITIAL_CONTENT_COMMAND,
        (payload: InitialContentPayload) => {
            if (payload.isDiffRequest && payload.originalContent && payload.modifiedContent) {
                payload.preventDefault()
                editor.update(() => {
                    $addUpdateTag("diff-initial-content")
                    $addUpdateTag("agenta:initial-content")

                    try {
                        let originalData: unknown, modifiedData: unknown

                        if (payload.language === "yaml") {
                            originalData = yaml.load(payload.originalContent!)
                            modifiedData = yaml.load(payload.modifiedContent!)
                        } else {
                            originalData = JSON5.parse(payload.originalContent!)
                            modifiedData = JSON5.parse(payload.modifiedContent!)
                        }

                        const diffContent = computeDiff(originalData, modifiedData, {
                            language: payload.language,
                            enableFolding,
                            foldThreshold,
                            showFoldedLineCount,
                        })

                        const hasChanges =
                            diffContent.includes("|added|") || diffContent.includes("|removed|")

                        if (!hasChanges && diffContent.trim()) {
                            const root = $getRoot()
                            root.clear()
                            return
                        }

                        const root = $getRoot()
                        root.clear()

                        const codeBlock = $createCodeBlockNode(payload.language)
                        const rawLines = diffContent.split("\n")

                        // Pre-parse all lines to extract diff metadata
                        const parsedLines = rawLines.map((line) => parseDiffLine(line))

                        // Pre-compute inline diff pairs for removed→added sequences.
                        const unifiedByRemovedIndex = new Map<
                            number,
                            {
                                unified: InlineDiffSegment[]
                                addedLineNumber?: number
                            }
                        >()
                        const skipIndices = new Set<number>()

                        for (let i = 0; i < parsedLines.length - 1; i++) {
                            const current = parsedLines[i]
                            const next = parsedLines[i + 1]
                            if (!current || !next) continue
                            if (
                                current.diffType === "removed" &&
                                next.diffType === "added" &&
                                typeof current.content === "string" &&
                                typeof next.content === "string"
                            ) {
                                // Skip inline diff for lines that exceed the truncation
                                // threshold — they'll be truncated to plain text anyway,
                                // and creating Lexical TextNodes with thousands of chars
                                // freezes the DOM reconciler.
                                if (
                                    current.content.length > DIFF_LINE_TRUNCATE_THRESHOLD ||
                                    next.content.length > DIFF_LINE_TRUNCATE_THRESHOLD
                                ) {
                                    continue
                                }
                                const inlinePair = buildInlineDiffPair(
                                    current.content,
                                    next.content,
                                )
                                if (inlinePair && inlinePair.unified.length > 0) {
                                    unifiedByRemovedIndex.set(i, {
                                        unified: inlinePair.unified,
                                        addedLineNumber: next.newLineNumber,
                                    })
                                    skipIndices.add(i + 1) // skip the added line
                                }
                            }
                        }

                        // Create line nodes with all diff properties set upfront
                        // to avoid the node transform cascade
                        const lineNodes: CodeLineNode[] = []
                        rawLines.forEach((lineContent, index) => {
                            if (lineContent.trim() || index < rawLines.length - 1) {
                                // Skip added lines that have been merged into a unified modified line
                                if (skipIndices.has(index)) return

                                const parsed = parsedLines[index]
                                const lineNode = $createCodeLineNode()

                                // Check if this removed line should become a unified modified line
                                const unifiedEntry = unifiedByRemovedIndex.get(index)

                                if (unifiedEntry && parsed) {
                                    // Create a single "modified" line with interleaved segments
                                    lineNode.setDiffType("modified")
                                    lineNode.setOldLineNumber(parsed.oldLineNumber)
                                    lineNode.setNewLineNumber(unifiedEntry.addedLineNumber)
                                    $setLineContentWithInlineDiff(
                                        lineNode,
                                        parsed.content,
                                        "modified",
                                        unifiedEntry.unified,
                                    )
                                } else if (parsed) {
                                    // Regular diff line (context, standalone removed/added, etc.)
                                    lineNode.setDiffType(parsed.diffType)
                                    lineNode.setOldLineNumber(parsed.oldLineNumber)
                                    lineNode.setNewLineNumber(parsed.newLineNumber)
                                    $setLineContentWithInlineDiff(
                                        lineNode,
                                        parsed.content,
                                        parsed.diffType,
                                    )
                                } else {
                                    lineNode.append($createTextNode(lineContent).setMode("token"))
                                }

                                lineNodes.push(lineNode)
                            }
                        })

                        // Mark diff as built BEFORE appending to root —
                        // appending triggers CodeBlockNode transforms synchronously,
                        // so the flag must be set first to prevent the infinite loop.
                        diffBuiltEditors.add(editor)

                        // Wrap in segments for efficient virtualization
                        $wrapLinesInSegments(lineNodes).forEach((node) => {
                            codeBlock.append(node)
                        })

                        root.append(codeBlock)
                    } catch (parseError) {
                        console.error("DiffHighlight: error building diff content:", parseError)
                    }
                })

                return true
            }
            // In diff mode, block ALL initial-content commands to prevent
            // other handlers from overwriting the diff-styled content.
            if (originalContent && modifiedContent) {
                return true
            }
            return false
        },
        COMMAND_PRIORITY_CRITICAL,
    )

    // No-op transforms for TextNode and CodeLineNode.
    // These absorb dirty nodes during Lexical's internal $applyAllTransforms loop,
    // preventing $normalizeTextNode from creating an infinite cycle when diff
    // content contains backtick characters.
    const removeTextTransform = editor.registerNodeTransform(TextNode, () => {})
    const removeLineTransform = editor.registerNodeTransform(CodeLineNode, () => {})

    const removeTransform = editor.registerNodeTransform(
        CodeBlockNode,
        (codeBlockNode: CodeBlockNode) => {
            if ($hasUpdateTag("agenta:bulk-clear")) {
                return
            }

            // Skip re-processing during the diff initial content update.
            // The INITIAL_CONTENT_COMMAND handler already set diff types
            // on all line nodes; re-parsing here would strip them because
            // the content is already cleaned (no pipe-delimited format).
            if ($hasUpdateTag("diff-initial-content")) {
                return
            }

            if (diffBuiltEditors.has(editor)) {
                return
            }

            const codeLines = $getAllCodeLines(codeBlockNode)

            // Quick check: if lines already have diff properties set (from initial creation),
            // verify a small sample to see if they're already correct and skip the full scan.
            // This avoids the expensive re-parse of all 5k+ lines on the initial transform pass.
            if (codeLines.length > 100) {
                let alreadyAnnotated = 0
                const sampleSize = Math.min(10, codeLines.length)
                for (let i = 0; i < sampleSize; i++) {
                    if (codeLines[i].getDiffType() !== null) {
                        alreadyAnnotated++
                    }
                }
                // If most sampled lines already have diff types, the initial creation
                // already set everything — skip the full transform
                if (alreadyAnnotated >= sampleSize * 0.8) {
                    return
                }
            }

            const blockText = codeBlockNode.getTextContent()

            if (!isDiffContent(blockText)) {
                codeLines.forEach((line: CodeLineNode) => {
                    if (line.getDiffType() !== null) {
                        line.setDiffType(null)
                    }
                })
                return
            }

            const parsedLines = codeLines.map((lineNode) =>
                parseDiffLine(lineNode.getTextContent()),
            )

            const inlineDiffByIndex = new Map<number, InlineDiffSegment[]>()
            for (let i = 0; i < parsedLines.length - 1; i++) {
                const current = parsedLines[i]
                const next = parsedLines[i + 1]
                if (!current || !next) continue

                const isReplacementPair =
                    current.diffType === "removed" &&
                    next.diffType === "added" &&
                    typeof current.content === "string" &&
                    typeof next.content === "string"

                if (!isReplacementPair) continue

                // Skip inline diff for lines exceeding the truncation threshold
                if (
                    current.content.length > DIFF_LINE_TRUNCATE_THRESHOLD ||
                    next.content.length > DIFF_LINE_TRUNCATE_THRESHOLD
                ) {
                    continue
                }

                const inlinePair = buildInlineDiffPair(current.content, next.content)
                if (!inlinePair) continue

                if (inlinePair.removed.length > 0) {
                    inlineDiffByIndex.set(i, inlinePair.removed)
                }
                if (inlinePair.added.length > 0) {
                    inlineDiffByIndex.set(i + 1, inlinePair.added)
                }
            }

            codeLines.forEach((lineNode: CodeLineNode, index: number) => {
                const parsed = parsedLines[index]

                if (parsed) {
                    const currentDiffType = lineNode.getDiffType()
                    const currentOldLineNumber = lineNode.getOldLineNumber()
                    const currentNewLineNumber = lineNode.getNewLineNumber()
                    const currentContent = lineNode.getTextContent()

                    if (parsed.diffType !== currentDiffType) {
                        lineNode.setDiffType(parsed.diffType)
                    }

                    if (parsed.oldLineNumber !== currentOldLineNumber) {
                        lineNode.setOldLineNumber(parsed.oldLineNumber)
                    }

                    if (parsed.newLineNumber !== currentNewLineNumber) {
                        lineNode.setNewLineNumber(parsed.newLineNumber)
                    }

                    const cleanContent = parsed.content
                    if (cleanContent !== currentContent) {
                        $setLineContentWithInlineDiff(
                            lineNode,
                            cleanContent,
                            parsed.diffType,
                            inlineDiffByIndex.get(index),
                        )
                    }
                }
            })
        },
    )

    let removeRootListener: (() => void) | null = null

    if (originalContent && modifiedContent) {
        const payload: InitialContentPayload = {
            content: "test",
            language,
            preventDefault: () => {},
            isDefaultPrevented: () => false,
            originalContent,
            modifiedContent,
            isDiffRequest: true,
        }

        // Check if root element is already available
        const existingRoot = editor.getRootElement()
        if (existingRoot) {
            // Defer dispatch to avoid nesting inside another Lexical update cycle
            // (e.g. history-merge from Strict Mode double-mount). Nested updates
            // cause the inner editor.update() to be batched, leading to two
            // reconciliation passes that can hang Lexical's reconciler.
            queueMicrotask(() => {
                editor.dispatchCommand(INITIAL_CONTENT_COMMAND, payload)
            })
        } else {
            // Defer dispatch until the editor has a root DOM element.
            // The extension's register callback runs during editor creation
            // (inside useMemo), before ContentEditable mounts. Without a root
            // element, Lexical processes state changes but skips DOM reconciliation.
            // By waiting for the root, we ensure createDOM() is called on diff nodes.
            let dispatched = false
            removeRootListener = editor.registerRootListener((rootElement) => {
                if (rootElement && !dispatched) {
                    dispatched = true
                    // Defer to next microtask so the dispatch runs outside
                    // any active Lexical update cycle, ensuring editor.update()
                    // in the command handler executes as a top-level update.
                    queueMicrotask(() => {
                        editor.dispatchCommand(INITIAL_CONTENT_COMMAND, payload)
                    })
                }
            })
        }
    }

    return () => {
        diffBuiltEditors.delete(editor)
        removeCommandListener()
        removeTransform()
        removeTextTransform()
        removeLineTransform()
        removeRootListener?.()
    }
}

// ─── Lexical Extension ───────────────────────────────────────────────────────

interface DiffHighlightConfig {
    originalContent: string | null
    modifiedContent: string | null
    language: "json" | "yaml"
    enableFolding: boolean
    foldThreshold: number
    showFoldedLineCount: boolean
}

export const DiffHighlightExtension = defineExtension({
    name: "@agenta/editor/code/DiffHighlight",
    config: {
        originalContent: null,
        modifiedContent: null,
        language: "json",
        enableFolding: false,
        foldThreshold: 5,
        showFoldedLineCount: true,
    } as DiffHighlightConfig,
    register: (editor, config) => {
        return registerDiffHighlightBehavior(editor, {
            originalContent: config.originalContent ?? undefined,
            modifiedContent: config.modifiedContent ?? undefined,
            language: config.language,
            enableFolding: config.enableFolding,
            foldThreshold: config.foldThreshold,
            showFoldedLineCount: config.showFoldedLineCount,
        })
    },
})

// ─── Legacy React plugin wrapper (backward compatibility) ────────────────────

/**
 * DiffHighlightPlugin component
 * Automatically detects and highlights diff content in code blocks.
 *
 * @deprecated Prefer using DiffHighlightExtension via configExtension() instead.
 */
export default function DiffHighlightPlugin({
    originalContent,
    modifiedContent,
    language = "json",
    enableFolding = false,
    foldThreshold = 5,
    showFoldedLineCount = true,
}: DiffHighlightPluginProps = {}): null {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        return registerDiffHighlightBehavior(editor, {
            originalContent,
            modifiedContent,
            language,
            enableFolding,
            foldThreshold,
            showFoldedLineCount,
        })
    }, [
        editor,
        originalContent,
        modifiedContent,
        language,
        enableFolding,
        foldThreshold,
        showFoldedLineCount,
    ])

    return null
}
