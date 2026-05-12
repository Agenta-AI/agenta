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
 * - Inline diff with character-level prefix/suffix matching
 * - Long line truncation with character count indicators
 *
 * ## Architecture:
 * - `registerDiffHighlightBehavior()` — registers diff building and transforms
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
    defineExtension,
    TextNode,
    type LexicalEditor,
} from "lexical"

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
    /** Fine-grained segment type for unified diff styling */
    segmentType?: "removed" | "added"
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

// ─── Truncation utilities ────────────────────────────────────────────────────

/** Maximum visible characters for truncated diff lines */
const DIFF_LINE_TRUNCATE_THRESHOLD = 200

/**
 * Format a character count for display in truncation indicators.
 */
function formatTruncatedCount(count: number): string {
    if (count >= 1000) {
        return `${(count / 1000).toFixed(1)}k`
    }
    return `${count}`
}

/** Inline style constants for diff segment types */
const DIFF_SEGMENT_STYLES = {
    removed:
        "background-color: rgba(220, 38, 38, 0.3); text-decoration: line-through; text-decoration-color: rgba(220, 38, 38, 0.6); border-radius: 2px; padding: 0 1px;",
    added: "background-color: rgba(22, 163, 74, 0.3); border-radius: 2px; padding: 0 1px;",
} as const

/**
 * Truncate a plain-text line (no inline diff segments).
 */
function $truncatePlainLine(content: string): string | null {
    if (content.length <= DIFF_LINE_TRUNCATE_THRESHOLD) return null

    const colonQuoteMatch = content.match(/^(\s*"[^"]*"\s*:\s*"?)/)
    if (colonQuoteMatch) {
        const keyPrefix = colonQuoteMatch[1]
        const valueContent = content.slice(keyPrefix.length)
        const keepChars = Math.max(40, DIFF_LINE_TRUNCATE_THRESHOLD - keyPrefix.length)
        if (valueContent.length > keepChars) {
            return (
                keyPrefix +
                valueContent.slice(0, keepChars) +
                ` … [${formatTruncatedCount(valueContent.length - keepChars)} chars]`
            )
        }
    }

    return (
        content.slice(0, DIFF_LINE_TRUNCATE_THRESHOLD) +
        ` … [${formatTruncatedCount(content.length - DIFF_LINE_TRUNCATE_THRESHOLD)} chars]`
    )
}

/**
 * Truncate inline diff segments in-place without changing segment count.
 * Each segment's text is shortened individually so the number of TextNodes
 * stays the same — adding nodes triggers a Lexical DOM reconciliation freeze.
 *
 * Strategy:
 * - Changed segments are kept fully visible (they're the point of the diff).
 * - Unchanged segments are truncated to keep total line length reasonable,
 *   preserving JSON key prefixes when the segment starts with one.
 */
function $truncateSegmentsInPlace(segments: InlineDiffSegment[]): InlineDiffSegment[] {
    const totalLength = segments.reduce((sum, s) => sum + s.text.length, 0)
    if (totalLength <= DIFF_LINE_TRUNCATE_THRESHOLD) return segments

    // Budget: total chars we can show for unchanged segments
    const changedLength = segments.reduce((sum, s) => (s.changed ? sum + s.text.length : sum), 0)
    const unchangedBudget = Math.max(80, DIFF_LINE_TRUNCATE_THRESHOLD - changedLength)
    const unchangedSegments = segments.filter((s) => !s.changed)
    const unchangedTotal = unchangedSegments.reduce((sum, s) => sum + s.text.length, 0)

    if (unchangedTotal <= unchangedBudget) return segments

    return segments.map((segment) => {
        if (segment.changed) return segment

        // Proportional share of the budget for this unchanged segment
        const share = Math.max(
            40,
            Math.floor((segment.text.length / unchangedTotal) * unchangedBudget),
        )
        if (segment.text.length <= share) return segment

        // Preserve JSON key prefix (e.g. `  "key": "`) in the first unchanged segment
        const colonQuoteMatch = segment.text.match(/^(\s*"[^"]*"\s*:\s*"?)/)
        if (colonQuoteMatch) {
            const keyPrefix = colonQuoteMatch[1]
            const valueContent = segment.text.slice(keyPrefix.length)
            const keepChars = Math.max(20, share - keyPrefix.length)
            if (valueContent.length > keepChars) {
                return {
                    ...segment,
                    text:
                        keyPrefix +
                        valueContent.slice(0, keepChars) +
                        ` … [${formatTruncatedCount(valueContent.length - keepChars)} chars]`,
                }
            }
        }

        return {
            ...segment,
            text:
                segment.text.slice(0, share) +
                ` … [${formatTruncatedCount(segment.text.length - share)} chars]`,
        }
    })
}

function $setLineContentWithInlineDiff(
    lineNode: CodeLineNode,
    fullContent: string,
    diffType: DiffType,
    segments?: InlineDiffSegment[] | null,
) {
    lineNode.clear()

    // No segments — plain text with optional truncation (single TextNode)
    if (!segments || segments.length === 0) {
        const displayText = $truncatePlainLine(fullContent) ?? fullContent
        lineNode.append($createTextNode(displayText).setMode("token"))
        return
    }

    // Truncate unchanged segments in-place (same segment count, shorter text)
    const displaySegments = $truncateSegmentsInPlace(segments)

    for (const segment of displaySegments) {
        const node = $createTextNode(segment.text).setMode("token")

        if (segment.segmentType === "removed") {
            node.setStyle(DIFF_SEGMENT_STYLES.removed)
        } else if (segment.segmentType === "added") {
            node.setStyle(DIFF_SEGMENT_STYLES.added)
        } else if (segment.changed) {
            const changedBg =
                diffType === "added" ? DIFF_SEGMENT_STYLES.added : DIFF_SEGMENT_STYLES.removed
            node.setStyle(changedBg)
        }

        lineNode.append(node)
    }
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

    // Build the diff content tree inside an editor.update() with
    // skipTransforms: true. Skipping transforms is critical — Lexical's
    // $applyAllTransforms iterates all dirty nodes after each update,
    // and with many appended nodes this causes the browser to freeze.
    const buildDiffContent = () => {
        editor.update(
            () => {
                $addUpdateTag("diff-initial-content")
                $addUpdateTag("agenta:initial-content")

                try {
                    let originalData: unknown, modifiedData: unknown

                    if (language === "yaml") {
                        originalData = yaml.load(originalContent!)
                        modifiedData = yaml.load(modifiedContent!)
                    } else {
                        originalData = JSON5.parse(originalContent!)
                        modifiedData = JSON5.parse(modifiedContent!)
                    }

                    const diffContent = computeDiff(originalData, modifiedData, {
                        language,
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

                    const codeBlock = $createCodeBlockNode(language)
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
                            const inlinePair = buildInlineDiffPair(current.content, next.content)
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

                    diffBuiltEditors.add(editor)

                    // Wrap lines in segments for virtualization, then append to tree
                    $wrapLinesInSegments(lineNodes).forEach((node) => {
                        codeBlock.append(node)
                    })

                    root.append(codeBlock)
                } catch (parseError) {
                    console.error("DiffHighlight: error building diff content:", parseError)
                }
            },
            {skipTransforms: true, discrete: true},
        )
    }

    const isDiffMode = Boolean(originalContent && modifiedContent)

    // No-op transforms for TextNode and CodeLineNode prevent
    // $normalizeTextNode from creating an infinite cycle when diff
    // content contains backtick characters.
    const removeTextTransform = editor.registerNodeTransform(TextNode, () => {})
    const removeLineTransform = editor.registerNodeTransform(CodeLineNode, () => {})

    // The CodeBlockNode transform is only needed for interactive editors
    // where diff-formatted text might be pasted in. In diff mode,
    // buildDiffContent() already handled everything above.
    const removeTransform = isDiffMode
        ? () => {}
        : editor.registerNodeTransform(CodeBlockNode, (codeBlockNode: CodeBlockNode) => {
              if ($hasUpdateTag("agenta:bulk-clear")) {
                  return
              }

              // Skip re-processing during the diff initial content update.
              // buildDiffContent() already set diff types on all line nodes;
              // re-parsing here would strip them because the content is
              // already cleaned (no pipe-delimited format).
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
          })

    // Build diff content AFTER the initial editor state is applied.
    // LexicalExtensionComposer applies $initialEditorState after extension
    // registration completes, which overwrites any content built synchronously
    // during register(). Deferring via registerUpdateListener ensures we run
    // after that initial state setup.
    let removeRootListener: (() => void) | null = null
    let rafId: number | null = null
    if (isDiffMode) {
        // Defer diff content build until the editor is attached to the DOM.
        // LexicalExtensionComposer applies the initial editor state after
        // extension registration, which overwrites synchronously-built content.
        // Waiting for the root element guarantees the editor is fully
        // initialized and DOM-attached before we populate the diff tree.
        const currentRoot = editor.getRootElement()
        if (currentRoot) {
            // Already attached — build immediately in next frame
            rafId = requestAnimationFrame(() => {
                rafId = null
                buildDiffContent()
            })
        } else {
            removeRootListener = editor.registerRootListener((rootElement) => {
                if (rootElement) {
                    removeRootListener?.()
                    removeRootListener = null
                    rafId = requestAnimationFrame(() => {
                        rafId = null
                        buildDiffContent()
                    })
                }
            })
        }
    }

    return () => {
        diffBuiltEditors.delete(editor)
        removeRootListener?.()
        if (rafId !== null) cancelAnimationFrame(rafId)
        removeTransform()
        removeTextTransform()
        removeLineTransform()
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
