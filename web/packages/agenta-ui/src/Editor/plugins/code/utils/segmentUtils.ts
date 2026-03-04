/**
 * segmentUtils.ts
 *
 * Compatibility utilities for the segmented CodeBlockNode architecture.
 * These functions provide the same logical view (CodeBlockNode → CodeLineNode)
 * regardless of whether segments are present, enabling incremental migration
 * of all 20+ consumer files.
 *
 * @module segmentUtils
 */
import type {LexicalNode} from "lexical"

import {$isCodeBlockNode, type CodeBlockNode} from "../nodes/CodeBlockNode"
import {$isCodeLineNode, type CodeLineNode} from "../nodes/CodeLineNode"
import {$createCodeSegmentNode, $isCodeSegmentNode} from "../nodes/CodeSegmentNode"

/** Default number of lines per segment during initial content loading. */
export const SEGMENT_SIZE = 200

/** Split a segment when it exceeds this many lines. */
const SEGMENT_MAX = 300

/** Merge two adjacent segments when their combined size is at or below this. */
const SEGMENT_MERGE_THRESHOLD = 100

/**
 * Get the CodeBlockNode ancestor for a given CodeLineNode.
 * Handles both the legacy flat structure (parent is CodeBlockNode)
 * and the segmented structure (parent is CodeSegmentNode → CodeBlockNode).
 */
export function $getCodeBlockForLine(line: LexicalNode): CodeBlockNode | null {
    const parent = line.getParent()
    if ($isCodeBlockNode(parent)) return parent
    if ($isCodeSegmentNode(parent)) {
        const grandparent = parent.getParent()
        if ($isCodeBlockNode(grandparent)) return grandparent
    }
    return null
}

/**
 * Get ALL CodeLineNodes from a CodeBlockNode in document order.
 * Transparently flattens segments — works with both flat and segmented structures.
 */
export function $getAllCodeLines(codeBlock: CodeBlockNode): CodeLineNode[] {
    const lines: CodeLineNode[] = []
    for (const child of codeBlock.getChildren()) {
        if ($isCodeLineNode(child)) {
            lines.push(child)
        } else if ($isCodeSegmentNode(child)) {
            for (const grandchild of child.getChildren()) {
                if ($isCodeLineNode(grandchild)) {
                    lines.push(grandchild)
                }
            }
        }
    }
    return lines
}

/**
 * Get the total line count across all segments.
 * More efficient than `$getAllCodeLines().length` — avoids array allocation.
 */
export function $getLineCount(codeBlock: CodeBlockNode): number {
    let count = 0
    for (const child of codeBlock.getChildren()) {
        if ($isCodeLineNode(child)) {
            count += 1
        } else if ($isCodeSegmentNode(child)) {
            count += child.getChildrenSize()
        }
    }
    return count
}

/**
 * Get the 0-based global line index of a CodeLineNode within the full document.
 * Accounts for preceding segments.
 */
export function $getGlobalLineIndex(line: CodeLineNode): number {
    const parent = line.getParent()

    if ($isCodeBlockNode(parent)) {
        // Legacy flat structure
        return line.getIndexWithinParent()
    }

    if ($isCodeSegmentNode(parent)) {
        const indexInSegment = line.getIndexWithinParent()
        const codeBlock = parent.getParent()
        if (!$isCodeBlockNode(codeBlock)) return indexInSegment

        let offset = 0
        for (const segment of codeBlock.getChildren()) {
            if (segment.getKey() === parent.getKey()) break
            if ($isCodeSegmentNode(segment)) {
                offset += segment.getChildrenSize()
            } else if ($isCodeLineNode(segment)) {
                offset += 1
            }
        }
        return offset + indexInSegment
    }

    return 0
}

/**
 * Get the CodeLineNode at a specific global (0-based) index.
 */
export function $getLineAtIndex(codeBlock: CodeBlockNode, index: number): CodeLineNode | null {
    let remaining = index
    for (const child of codeBlock.getChildren()) {
        if ($isCodeLineNode(child)) {
            if (remaining === 0) return child
            remaining -= 1
        } else if ($isCodeSegmentNode(child)) {
            const size = child.getChildrenSize()
            if (remaining < size) {
                const target = child.getChildAtIndex(remaining)
                return $isCodeLineNode(target) ? target : null
            }
            remaining -= size
        }
    }
    return null
}

/**
 * Get the next CodeLineNode after the given line, crossing segment boundaries.
 * Returns null if this is the last line in the document.
 */
export function $getNextCodeLine(line: CodeLineNode): CodeLineNode | null {
    // Try within the same parent first
    const next = line.getNextSibling()
    if ($isCodeLineNode(next)) return next

    // Cross segment boundary
    const parent = line.getParent()
    if ($isCodeSegmentNode(parent)) {
        const nextSegment = parent.getNextSibling()
        if ($isCodeSegmentNode(nextSegment)) {
            const firstChild = nextSegment.getFirstChild()
            if ($isCodeLineNode(firstChild)) return firstChild
        }
    }
    return null
}

/**
 * Get the previous CodeLineNode before the given line, crossing segment boundaries.
 * Returns null if this is the first line in the document.
 */
export function $getPreviousCodeLine(line: CodeLineNode): CodeLineNode | null {
    // Try within the same parent first
    const prev = line.getPreviousSibling()
    if ($isCodeLineNode(prev)) return prev

    // Cross segment boundary
    const parent = line.getParent()
    if ($isCodeSegmentNode(parent)) {
        const prevSegment = parent.getPreviousSibling()
        if ($isCodeSegmentNode(prevSegment)) {
            const lastChild = prevSegment.getLastChild()
            if ($isCodeLineNode(lastChild)) return lastChild
        }
    }
    return null
}

/**
 * Wrap an array of CodeLineNodes into CodeSegmentNodes.
 * Used during initial content loading and language switching.
 * For small documents (under segmentSize lines), still wraps in a single segment
 * so the structure is consistent.
 */
export function $wrapLinesInSegments(
    lines: CodeLineNode[],
    segmentSize: number = SEGMENT_SIZE,
): LexicalNode[] {
    if (lines.length === 0) {
        const segment = $createCodeSegmentNode()
        return [segment]
    }

    const segments: LexicalNode[] = []
    for (let i = 0; i < lines.length; i += segmentSize) {
        const segment = $createCodeSegmentNode()
        const chunk = lines.slice(i, i + segmentSize)
        chunk.forEach((line) => segment.append(line))
        segments.push(segment)
    }
    return segments
}

/**
 * Rebalance segments within a CodeBlockNode.
 *
 * - Splits segments exceeding SEGMENT_MAX lines into SEGMENT_SIZE chunks.
 * - Merges adjacent segments whose combined size is ≤ SEGMENT_MERGE_THRESHOLD.
 *
 * Returns true if any structural changes were made, false otherwise.
 * Designed to be called from `requestIdleCallback` after edits — never on
 * the latency-sensitive Enter key path.
 */
export function $rebalanceSegments(codeBlock: CodeBlockNode): boolean {
    const children = codeBlock.getChildren()
    let changed = false

    // Pass 1: split oversized segments
    for (const child of children) {
        if (!$isCodeSegmentNode(child)) continue
        const size = child.getChildrenSize()
        if (size <= SEGMENT_MAX) continue

        // Collect all lines from the oversized segment
        const lines = child.getChildren().filter($isCodeLineNode)
        // Keep the first SEGMENT_SIZE lines in the original segment.
        // Move the rest into new segments inserted sequentially after it.
        let cursor: LexicalNode = child
        for (let i = SEGMENT_SIZE; i < lines.length; i += SEGMENT_SIZE) {
            const newSegment = $createCodeSegmentNode()
            const chunk = lines.slice(i, i + SEGMENT_SIZE)
            chunk.forEach((line) => newSegment.append(line))
            cursor.insertAfter(newSegment)
            cursor = newSegment
        }
        changed = true
    }

    // Pass 2: merge undersized adjacent segments.
    // Re-fetch children on each iteration since removals mutate the tree.
    let segments = codeBlock.getChildren()
    let i = 0
    while (i < segments.length - 1) {
        const current = segments[i]
        const next = segments[i + 1]
        if (!$isCodeSegmentNode(current) || !$isCodeSegmentNode(next)) {
            i++
            continue
        }

        const combined = current.getChildrenSize() + next.getChildrenSize()
        if (combined > SEGMENT_MERGE_THRESHOLD) {
            i++
            continue
        }

        // Move all lines from `next` into `current`
        const linesToMove = next.getChildren()
        linesToMove.forEach((line) => current.append(line))
        next.remove()
        changed = true
        // Re-fetch after mutation; don't advance i — re-check current
        // against its new next sibling
        segments = codeBlock.getChildren()
    }

    return changed
}
