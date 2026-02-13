/**
 * DiffHighlightPlugin.tsx
 *
 * This plugin provides diff highlighting functionality for code blocks with support
 * for both JSON and YAML content. It processes original and modified content to
 * generate and display unified diff format with proper syntax highlighting.
 *
 * ## Features:
 * - Automatic detection of diff format lines
 * - Support for unified diff format
 * - JSON and YAML language support
 * - Integration with existing syntax highlighting
 * - Line-by-line diff state management
 * - Real-time diff computation
 *
 * ## How It Works:
 *
 * ### 1. Content Processing
 * When `originalContent` and `modifiedContent` are provided:
 * - Content is parsed based on the `language` parameter ("json" | "yaml")
 * - Objects are normalized and re-serialized for consistent formatting
 * - Line-by-line diff is computed using the `computeDiff` utility
 *
 * ### 2. Diff Format
 * The plugin generates GitHub-style diff format:
 * ```
 * oldLineNum|newLineNum|type|content
 * ```
 * Where:
 * - `oldLineNum`: Line number in original content (empty for added lines)
 * - `newLineNum`: Line number in modified content (empty for removed lines)
 * - `type`: "added" | "removed" | "context"
 * - `content`: The actual line content
 *
 * ### 3. Language Support
 * **JSON Mode (`language="json"`):**
 * - Parses content as JSON objects
 * - Re-serializes with consistent 2-space indentation
 * - Handles JSON syntax errors gracefully
 *
 * **YAML Mode (`language="yaml"`):**
 * - Parses content as YAML objects using `js-yaml`
 * - Re-serializes with consistent 2-space indentation
 * - Handles YAML syntax errors gracefully
 *
 * ### 4. Visual Highlighting
 * - Added lines: Green background with "+" indicator
 * - Removed lines: Red background with "-" indicator
 * - Context lines: Normal styling
 * - Line numbers displayed for both old and new versions
 *
 * ## Usage Examples:
 *
 * ### Basic Usage
 * ```tsx
 * <DiffHighlightPlugin
 *   originalContent='{"name": "old"}'
 *   modifiedContent='{"name": "new"}'
 *   language="json"
 * />
 * ```
 *
 * ### YAML Diff
 * ```tsx
 * <DiffHighlightPlugin
 *   originalContent="name: old-service\nversion: 1.0.0"
 *   modifiedContent="name: new-service\nversion: 1.1.0"
 *   language="yaml"
 * />
 * ```
 *
 * ### Integration with EditorWrapper
 * ```tsx
 * <EditorWrapper
 *   additionalCodePlugins={[
 *     <DiffHighlightPlugin
 *       originalContent={original}
 *       modifiedContent={modified}
 *       language={language}
 *     />
 *   ]}
 * />
 * ```
 *
 * ## Error Handling:
 * - Invalid JSON/YAML content is handled gracefully
 * - Parsing errors don't crash the diff computation
 * - Fallback to string-based diff for unparseable content
 *
 * @module DiffHighlightPlugin
 */

import {useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import yaml from "js-yaml"
import JSON5 from "json5"
import {$createTextNode, $getRoot, COMMAND_PRIORITY_CRITICAL} from "lexical"

import {
    INITIAL_CONTENT_COMMAND,
    InitialContentPayload,
} from "../../../commands/InitialContentCommand"
import {computeDiff, isContentIncomplete} from "../../../utils/diffUtils"
import {$createCodeBlockNode} from "../nodes/CodeBlockNode"
import {CodeBlockNode} from "../nodes/CodeBlockNode"
import {$createCodeLineNode} from "../nodes/CodeLineNode"
import {$isCodeLineNode, CodeLineNode, DiffType} from "../nodes/CodeLineNode"

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

interface InlineDiffSegment {
    text: string
    changed: boolean
    truncated?: boolean
}

interface InlineDiffPair {
    removed: InlineDiffSegment[]
    added: InlineDiffSegment[]
}

interface TokenDiffOp {
    type: "equal" | "insert" | "delete"
    text: string
}

const INLINE_DIFF_MIN_OVERLAP_RATIO = 0.18
const INLINE_DIFF_MAX_TOKEN_COUNT = 220
const INLINE_DIFF_EDGE_CONTEXT_CHARS = 64
const INLINE_DIFF_MIDDLE_CONTEXT_CHARS = 24
const INLINE_DIFF_MIDDLE_TRUNCATE_THRESHOLD = 160
const INLINE_DIFF_TRUNCATION_SUFFIX = " unchanged chars omitted ...]"

function buildTruncationMarker(hiddenChars: number): InlineDiffSegment {
    return {
        text: `[... ${hiddenChars}${INLINE_DIFF_TRUNCATION_SUFFIX}`,
        changed: false,
        truncated: true,
    }
}

function pushInlineSegment(
    segments: InlineDiffSegment[],
    text: string,
    changed: boolean,
    truncated = false,
): InlineDiffSegment[] {
    if (!text) return segments

    const previous = segments[segments.length - 1]
    if (previous && previous.changed === changed && Boolean(previous.truncated) === truncated) {
        previous.text += text
        return segments
    }

    segments.push({text, changed, truncated})
    return segments
}

function getLastChangedIndex(segments: InlineDiffSegment[]): number {
    for (let index = segments.length - 1; index >= 0; index--) {
        if (segments[index].changed) return index
    }
    return -1
}

function truncateSegment({
    text,
    isLeading,
    isTrailing,
}: {
    text: string
    isLeading: boolean
    isTrailing: boolean
}): InlineDiffSegment[] {
    if (isLeading || isTrailing) {
        if (text.length <= INLINE_DIFF_EDGE_CONTEXT_CHARS) {
            return [{text, changed: false}]
        }

        const hiddenChars = text.length - INLINE_DIFF_EDGE_CONTEXT_CHARS
        if (isLeading) {
            return [
                buildTruncationMarker(hiddenChars),
                {
                    text: text.slice(-INLINE_DIFF_EDGE_CONTEXT_CHARS),
                    changed: false,
                },
            ]
        }

        return [
            {
                text: text.slice(0, INLINE_DIFF_EDGE_CONTEXT_CHARS),
                changed: false,
            },
            buildTruncationMarker(hiddenChars),
        ]
    }

    if (text.length <= INLINE_DIFF_MIDDLE_TRUNCATE_THRESHOLD) return [{text, changed: false}]

    const hiddenChars = text.length - INLINE_DIFF_MIDDLE_CONTEXT_CHARS * 2
    return [
        {
            text: text.slice(0, INLINE_DIFF_MIDDLE_CONTEXT_CHARS),
            changed: false,
        },
        buildTruncationMarker(hiddenChars),
        {
            text: text.slice(-INLINE_DIFF_MIDDLE_CONTEXT_CHARS),
            changed: false,
        },
    ]
}

function truncateInlineSegments(segments: InlineDiffSegment[]): InlineDiffSegment[] {
    const firstChangedIndex = segments.findIndex((segment) => segment.changed)
    if (firstChangedIndex < 0) return segments

    const lastChangedIndex = getLastChangedIndex(segments)
    const truncatedSegments: InlineDiffSegment[] = []

    segments.forEach((segment, index) => {
        if (segment.changed) {
            pushInlineSegment(truncatedSegments, segment.text, true)
            return
        }

        const isLeading = index < firstChangedIndex
        const isTrailing = index > lastChangedIndex
        truncateSegment({
            text: segment.text,
            isLeading,
            isTrailing,
        }).forEach((truncatedSegment) => {
            pushInlineSegment(
                truncatedSegments,
                truncatedSegment.text,
                truncatedSegment.changed,
                Boolean(truncatedSegment.truncated),
            )
        })
    })

    return truncatedSegments
}

function tokenizeInlineDiff(line: string): string[] {
    return line.match(/\s+|[a-zA-Z0-9_]+|./g) ?? []
}

function computeTokenDiff(removedTokens: string[], addedTokens: string[]): TokenDiffOp[] {
    const removedLength = removedTokens.length
    const addedLength = addedTokens.length

    const dp: number[][] = Array.from({length: removedLength + 1}, () =>
        Array(addedLength + 1).fill(0),
    )

    for (let i = 1; i <= removedLength; i++) {
        for (let j = 1; j <= addedLength; j++) {
            if (removedTokens[i - 1] === addedTokens[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
            }
        }
    }

    const reversed: TokenDiffOp[] = []
    let i = removedLength
    let j = addedLength

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && removedTokens[i - 1] === addedTokens[j - 1]) {
            reversed.push({type: "equal", text: removedTokens[i - 1]})
            i--
            j--
            continue
        }

        if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            reversed.push({type: "insert", text: addedTokens[j - 1]})
            j--
            continue
        }

        reversed.push({type: "delete", text: removedTokens[i - 1]})
        i--
    }

    const merged: TokenDiffOp[] = []
    for (let index = reversed.length - 1; index >= 0; index--) {
        const op = reversed[index]
        const previous = merged[merged.length - 1]
        if (previous && previous.type === op.type) {
            previous.text += op.text
        } else {
            merged.push({...op})
        }
    }

    return merged
}

function buildInlineDiffFromTokenDiff(
    removedLine: string,
    addedLine: string,
    ops: TokenDiffOp[],
): InlineDiffPair | null {
    const removedSegments: InlineDiffSegment[] = []
    const addedSegments: InlineDiffSegment[] = []
    let unchangedChars = 0

    ops.forEach((op) => {
        if (op.type === "equal") {
            unchangedChars += op.text.length
            pushInlineSegment(removedSegments, op.text, false)
            pushInlineSegment(addedSegments, op.text, false)
            return
        }

        if (op.type === "delete") {
            pushInlineSegment(removedSegments, op.text, true)
            return
        }

        pushInlineSegment(addedSegments, op.text, true)
    })

    const overlapRatio = unchangedChars / Math.max(removedLine.length, addedLine.length)
    if (overlapRatio < INLINE_DIFF_MIN_OVERLAP_RATIO) return null

    const hasRemovedChange = removedSegments.some((segment) => segment.changed)
    const hasAddedChange = addedSegments.some((segment) => segment.changed)
    if (!hasRemovedChange && !hasAddedChange) return null

    return {
        removed: truncateInlineSegments(removedSegments),
        added: truncateInlineSegments(addedSegments),
    }
}

function buildInlineDiffFromPrefixSuffix(
    removedLine: string,
    addedLine: string,
): InlineDiffPair | null {
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

    // If there is very little overlap, full line-level highlighting is usually clearer.
    if (overlapRatio < INLINE_DIFF_MIN_OVERLAP_RATIO) return null

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
        return truncateInlineSegments(segments)
    }

    return {
        removed: toSegments(removedMiddle, Boolean(removedMiddle)),
        added: toSegments(addedMiddle, Boolean(addedMiddle)),
    }
}

function buildInlineDiffPair(removedLine: string, addedLine: string): InlineDiffPair | null {
    if (!removedLine || !addedLine || removedLine === addedLine) return null

    const removedTokens = tokenizeInlineDiff(removedLine)
    const addedTokens = tokenizeInlineDiff(addedLine)

    const canUseTokenDiff =
        removedTokens.length <= INLINE_DIFF_MAX_TOKEN_COUNT &&
        addedTokens.length <= INLINE_DIFF_MAX_TOKEN_COUNT

    if (canUseTokenDiff) {
        const tokenDiffPair = buildInlineDiffFromTokenDiff(
            removedLine,
            addedLine,
            computeTokenDiff(removedTokens, addedTokens),
        )
        if (tokenDiffPair) return tokenDiffPair
    }

    return buildInlineDiffFromPrefixSuffix(removedLine, addedLine)
}

function $setLineContentWithInlineDiff(
    lineNode: CodeLineNode,
    fullContent: string,
    diffType: DiffType,
    segments?: InlineDiffSegment[] | null,
) {
    lineNode.clear()

    if (!segments || segments.length === 0) {
        lineNode.append($createTextNode(fullContent))
        return
    }

    const changedBg = diffType === "added" ? "rgba(22, 163, 74, 0.35)" : "rgba(220, 38, 38, 0.35)"
    const truncationStyle =
        "background-color: rgba(100, 116, 139, 0.18); color: #334155; border-radius: 3px; padding: 0 4px; font-style: italic;"

    segments.forEach((segment) => {
        const node = $createTextNode(segment.text)
        if (segment.changed) {
            node.setStyle(`background-color: ${changedBg}; border-radius: 2px; padding: 0 1px;`)
        } else if (segment.truncated) {
            node.setStyle(truncationStyle)
        }
        lineNode.append(node)
    })
}

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

    // Check if content appears to be diff format

    return isDiff
}

/**
 * DiffHighlightPlugin component
 * Automatically detects and highlights diff content in code blocks
 */
export default function DiffHighlightPlugin({
    originalContent,
    modifiedContent,
    language = "json",
    enableFolding = false,
    foldThreshold = 5,
    showFoldedLineCount = true,
}: {
    originalContent?: string
    modifiedContent?: string
    language?: "json" | "yaml"
    enableFolding?: boolean
    foldThreshold?: number
    showFoldedLineCount?: boolean
} = {}): null {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        // Register command listener to handle initial content
        const removeCommandListener = editor.registerCommand(
            INITIAL_CONTENT_COMMAND,
            (payload: InitialContentPayload) => {
                // Check if this is a diff request with original and modified content
                if (payload.isDiffRequest && payload.originalContent && payload.modifiedContent) {
                    // Prevent default handling by the InsertInitialCodeBlockPlugin
                    payload.preventDefault()
                    // Compute diff and handle editor hydration
                    editor.update(() => {
                        try {
                            // Check if content is incomplete
                            const originalIncomplete = isContentIncomplete(
                                payload.originalContent!,
                                payload.language,
                            )
                            const modifiedIncomplete = isContentIncomplete(
                                payload.modifiedContent!,
                                payload.language,
                            )

                            if (originalIncomplete || modifiedIncomplete) {
                                // Don't compute diff for incomplete content
                                return
                            }

                            // Parse content based on language
                            let originalData: any, modifiedData: any

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

                            // Check if diff contains only context lines (no actual changes)
                            const hasChanges =
                                diffContent.includes("|added|") || diffContent.includes("|removed|")

                            if (!hasChanges && diffContent.trim()) {
                                // All lines are context - no actual differences, clear editor
                                const root = $getRoot()
                                root.clear()
                                return
                            }

                            // Create code block with diff content
                            const root = $getRoot()
                            root.clear()

                            const codeBlock = $createCodeBlockNode(payload.language)
                            const lines = diffContent.split("\n")

                            lines.forEach((lineContent, index) => {
                                if (lineContent.trim() || index < lines.length - 1) {
                                    const lineNode = $createCodeLineNode()
                                    lineNode.append($createTextNode(lineContent))
                                    codeBlock.append(lineNode)
                                }
                            })

                            root.append(codeBlock)
                        } catch (parseError) {
                            // Handle parse errors - could set error state if needed
                            console.warn("DiffHighlightPlugin: Parse error", parseError)
                        }
                    })

                    return true // Command handled
                }
                return false // Let other plugins handle it
            },
            COMMAND_PRIORITY_CRITICAL,
        )
        // Register a transform that runs on CodeBlockNode changes
        const removeTransform = editor.registerNodeTransform(
            CodeBlockNode,
            (codeBlockNode: CodeBlockNode) => {
                const blockText = codeBlockNode.getTextContent()
                // Process code block for diff highlighting

                // Check if this block contains diff content
                if (!isDiffContent(blockText)) {
                    // Clear diff styling for non-diff content
                    // Clear any existing diff styling if this is no longer diff content
                    const codeLines = codeBlockNode.getChildren().filter($isCodeLineNode)
                    codeLines.forEach((line: CodeLineNode) => {
                        if (line.getDiffType() !== null) {
                            line.setDiffType(null)
                        }
                    })
                    return
                }

                const codeLines = codeBlockNode.getChildren().filter($isCodeLineNode)
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
                    // Process individual line for diff styling

                    if (parsed) {
                        const currentDiffType = lineNode.getDiffType()
                        const currentOldLineNumber = lineNode.getOldLineNumber()
                        const currentNewLineNumber = lineNode.getNewLineNumber()
                        const currentContent = lineNode.getTextContent()

                        // Update diff type if changed
                        if (parsed.diffType !== currentDiffType) {
                            lineNode.setDiffType(parsed.diffType)
                        }

                        // Update line numbers if changed
                        if (parsed.oldLineNumber !== currentOldLineNumber) {
                            lineNode.setOldLineNumber(parsed.oldLineNumber)
                        }

                        if (parsed.newLineNumber !== currentNewLineNumber) {
                            lineNode.setNewLineNumber(parsed.newLineNumber)
                        }

                        // Update line content to remove diff formatting (preserve indentation)
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

        return () => {
            removeCommandListener()
            removeTransform()
        }
    }, [editor])

    // Dispatch diff computation command when original/modified content is provided
    useEffect(() => {
        if (originalContent && modifiedContent) {
            const payload: InitialContentPayload = {
                content: "test", // Not used for diff requests
                language: language, // Use the language parameter
                preventDefault: () => {},
                isDefaultPrevented: () => false,
                originalContent,
                modifiedContent,
                isDiffRequest: true,
            }
            editor.dispatchCommand(INITIAL_CONTENT_COMMAND, payload)
        }
    }, [originalContent, modifiedContent, editor])

    return null
}
