import {createLogger} from "@agenta/shared/utils"
import {$getNodeByKey, $hasUpdateTag, type EditorState, type LexicalEditor} from "lexical"

import {$isCodeLineNode, CodeLineNode} from "../../nodes/CodeLineNode"
import {getIndentCount, isFoldableLine} from "../../utils/indent"
import {
    $getAllCodeLines,
    $getCodeBlockForLine,
    $getGlobalLineIndex,
    $getLineCount,
} from "../../utils/segmentUtils"
import {ENTER_KEY_UPDATE_TAG} from "../highlight/updateTags"

import type {CodeFoldingCoreOutput, FoldingLineInfo} from "./types"

export const FOLD_UPDATE_TAG = "fold-toggle"

const log = createLogger("CodeFoldingCore", {disabled: true})
const DEBUG_ENTER_FOLDING_PROFILE = true
const FOLDING_VIEWPORT_BUFFER_PX = 480
const MAX_LINES_FOR_FOLDING_OVERLAY = 8000

/**
 * On unfold, reveal this many lines near the fold point immediately.
 * The rest stay hidden via `.virtual-hidden` until the virtualization
 * controller refines the range with geometry-based measurements.
 */
const UNFOLD_REVEAL_LINES = 400

function getNow(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now()
    }
    return Date.now()
}

function areLineInfosEqual(prev: FoldingLineInfo[], next: FoldingLineInfo[]): boolean {
    if (prev.length !== next.length) {
        return false
    }

    for (let i = 0; i < prev.length; i++) {
        const prevLine = prev[i]
        const nextLine = next[i]
        if (
            prevLine.key !== nextLine.key ||
            prevLine.top !== nextLine.top ||
            prevLine.height !== nextLine.height ||
            prevLine.collapsed !== nextLine.collapsed ||
            prevLine.foldable !== nextLine.foldable
        ) {
            return false
        }
    }

    return true
}

// ---------------------------------------------------------------------------
// Pending fold toggle — bridges Phase 1 (editor.update) to Phase 2
// (update listener). Populated by toggleFoldDirect, consumed by the update
// listener which fires synchronously after Lexical reconciliation.
// ---------------------------------------------------------------------------
interface PendingFoldToggle {
    isCollapsed: boolean
    lineKeys: string[]
    firstLineAfterFoldKey: string | null
    firstLineAfterFoldIndex: number
}

let pendingFoldToggle: PendingFoldToggle | null = null

/** Track elements that have fold-related counter-set for cleanup. */
const foldCounterSetElements = new Set<HTMLElement>()

/**
 * Apply fold/unfold visibility changes to DOM elements.
 *
 * Called from the Lexical update listener (after reconciliation) — NOT from
 * a rAF. This is safe because:
 * 1. Update listeners fire after Lexical reconciles the DOM.
 * 2. Only the fold line itself is dirty (setCollapsed); fold range lines
 *    are NOT dirty so Lexical's reconciler won't override our class changes.
 * 3. classList operations are write-only (no geometry reads) → no forced reflow.
 */
function applyFoldClassChanges(editor: LexicalEditor, toggle: PendingFoldToggle): void {
    const {isCollapsed, lineKeys, firstLineAfterFoldKey, firstLineAfterFoldIndex} = toggle

    if (isCollapsed) {
        // FOLD: add .folded to all lines in range.
        // Adding display:none never triggers layout — the browser just marks
        // elements as needing no layout, which is essentially free.
        for (const key of lineKeys) {
            const element = editor.getElementByKey(key)
            if (element) {
                element.classList.add("folded")
            }
        }
    } else {
        // UNFOLD: Remove .folded from all lines. For lines beyond the
        // immediate viewport estimate, add .virtual-hidden so they stay
        // hidden until virtualization refines the range. This prevents all
        // 5400 lines from being simultaneously visible (which would cause
        // a massive forced reflow when virtualization reads geometry).
        const revealEnd = Math.min(UNFOLD_REVEAL_LINES, lineKeys.length)
        for (let i = 0; i < lineKeys.length; i++) {
            const element = editor.getElementByKey(lineKeys[i])
            if (!element) continue
            element.classList.remove("folded")
            if (i >= revealEnd) {
                element.classList.add("virtual-hidden")
            }
        }
    }

    // Fix CSS counter line numbers for the first visible line after fold.
    if (firstLineAfterFoldKey) {
        const afterFoldEl = editor.getElementByKey(firstLineAfterFoldKey)
        if (afterFoldEl) {
            if (isCollapsed) {
                afterFoldEl.style.setProperty(
                    "counter-set",
                    `line-number ${firstLineAfterFoldIndex}`,
                )
                foldCounterSetElements.add(afterFoldEl)
            } else {
                afterFoldEl.style.removeProperty("counter-set")
                foldCounterSetElements.delete(afterFoldEl)
            }
        }
    }

    log("applyFoldClassChanges", {
        collapsed: isCollapsed,
        linesToggled: lineKeys.length,
    })
}

/**
 * Toggle fold on a line.
 *
 * Phase 1 (here): Lexical state update — sets isCollapsed on the clicked
 * line and collects all line keys in the fold range. Stores the result in
 * `pendingFoldToggle` for the update listener.
 *
 * Phase 2 (update listener): After Lexical reconciles, applies CSS class
 * changes synchronously. No rAF needed — class writes don't force reflow.
 *
 * Uses Lexical node data (not DOM textContent) so it works even when
 * virtualization has detached children from off-screen lines.
 */
function toggleFoldDirect(editor: LexicalEditor, lineKey: string) {
    editor.update(
        () => {
            const node = $getNodeByKey(lineKey)
            if (!$isCodeLineNode(node) || !node.isFoldable()) return

            const isNowCollapsed = !node.isCollapsed()
            node.setCollapsed(isNowCollapsed)

            const baseIndent = getIndentCount(node.getTextContent())
            const codeBlock = $getCodeBlockForLine(node)
            if (!codeBlock) return

            const allLines = $getAllCodeLines(codeBlock)
            const startIndex = $getGlobalLineIndex(node)
            const lineKeys: string[] = []

            let i = startIndex + 1
            for (; i < allLines.length; i++) {
                const line = allLines[i]
                if (getIndentCount(line.getTextContent()) <= baseIndent) break
                lineKeys.push(line.getKey())
            }

            if (lineKeys.length === 0) return

            let firstLineAfterFoldKey: string | null = null
            let firstLineAfterFoldIndex = -1
            if (i < allLines.length) {
                firstLineAfterFoldKey = allLines[i].getKey()
                firstLineAfterFoldIndex = i
            }

            pendingFoldToggle = {
                isCollapsed: isNowCollapsed,
                lineKeys,
                firstLineAfterFoldKey,
                firstLineAfterFoldIndex,
            }
        },
        {tag: FOLD_UPDATE_TAG},
    )
}

export function createCodeFoldingCoreOutput(editor: LexicalEditor): CodeFoldingCoreOutput {
    let lines: FoldingLineInfo[] = []
    const listeners = new Set<() => void>()

    return {
        getLines: () => lines,
        subscribe: (listener) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        toggleLineByKey: (lineKey) => {
            toggleFoldDirect(editor, lineKey)
        },
        setLines: (nextLines) => {
            if (areLineInfosEqual(lines, nextLines)) {
                return
            }
            lines = nextLines
            listeners.forEach((listener) => listener())
        },
    }
}

function $getLineByKey(key: string): CodeLineNode | null {
    const node = $getNodeByKey(key)
    return $isCodeLineNode(node) ? node : null
}

function $computeFoldingLineInfos(editor: LexicalEditor): FoldingLineInfo[] {
    const rootElement = editor.getRootElement()
    if (!rootElement) {
        return []
    }

    const domRoot = rootElement as HTMLElement
    // Query only visible lines — skip folded (display: none from fold) and
    // virtual-hidden lines. This reduces the iteration from 5400 to ~63
    // elements after a large fold collapse.
    const lineElements = domRoot.querySelectorAll<HTMLElement>(
        "div.editor-code-line:not(.folded):not(.virtual-hidden)",
    )
    if (lineElements.length > MAX_LINES_FOR_FOLDING_OVERLAY) {
        // Avoid expensive per-line layout reads for large documents.
        return []
    }

    // The fold overlay portals into .editor-inner, so compute positions relative
    // to that element. Use the scrollable ancestor for viewport filtering.
    const portalTarget = domRoot.closest(".editor-inner") as HTMLElement | null
    const portalRect = portalTarget ? portalTarget.getBoundingClientRect() : null

    // Use the portal target (or nearest scrollable ancestor) for scroll/viewport
    // calculations, since .editor-inner is the actual scroll container.
    const scrollContainer = portalTarget ?? domRoot
    const viewportHeight = scrollContainer.clientHeight
    const shouldFilterByViewport = viewportHeight > 0

    // Collect only foldable lines (no layout reads yet).
    const foldableCandidates: {element: HTMLElement; node: CodeLineNode}[] = []
    for (const lineElement of lineElements) {
        const key = lineElement.getAttribute("data-lexical-node-key")
        if (!key) {
            continue
        }
        const node = $getLineByKey(key)
        if (!node || !node.isFoldable()) {
            continue
        }
        foldableCandidates.push({element: lineElement, node})
    }

    // Second pass: read layout only for foldable, visible lines.
    // Use getBoundingClientRect for both viewport filtering and positioning —
    // it's reliable across nested positioning/scrolling contexts.
    const scrollContainerRect = scrollContainer.getBoundingClientRect()
    const nextLines: FoldingLineInfo[] = []
    for (const {element, node} of foldableCandidates) {
        const lineRect = element.getBoundingClientRect()
        const height = lineRect.height
        if (height === 0) continue // hidden/collapsed line

        if (shouldFilterByViewport) {
            // Filter using viewport-relative positions (getBoundingClientRect)
            const aboveViewport =
                lineRect.bottom < scrollContainerRect.top - FOLDING_VIEWPORT_BUFFER_PX
            const belowViewport =
                lineRect.top > scrollContainerRect.bottom + FOLDING_VIEWPORT_BUFFER_PX
            if (aboveViewport || belowViewport) {
                continue
            }
        }

        // Compute position relative to .editor-inner (portal target)
        let top: number
        if (portalRect) {
            top = lineRect.top - portalRect.top + (portalTarget?.scrollTop ?? 0)
        } else {
            top = element.offsetTop
        }

        nextLines.push({
            key: node.getKey(),
            top: Math.round(top),
            height: Math.round(height),
            collapsed: node.isCollapsed(),
            foldable: true,
        })
    }

    return nextLines
}

export function registerCodeFoldingCore(
    editor: LexicalEditor,
    output: CodeFoldingCoreOutput,
): () => void {
    let rafId: number | null = null
    let pendingEditorState: EditorState | null = null
    let pendingReason: "regular" | "enter" = "regular"
    let pendingScheduledAtMs = 0
    let attachedRoot: HTMLElement | null = null

    const computeAndPublish = (editorState: EditorState): number => {
        let nextLineCount = 0
        editorState.read(() => {
            const nextLines = $computeFoldingLineInfos(editor)
            nextLineCount = nextLines.length
            output.setLines(nextLines)
        })
        return nextLineCount
    }

    const cancelPendingRaf = () => {
        if (rafId !== null && typeof window !== "undefined") {
            window.cancelAnimationFrame(rafId)
            rafId = null
        }
    }

    const scheduleCompute = (editorState: EditorState, reason: "regular" | "enter" = "regular") => {
        pendingEditorState = editorState
        pendingReason = reason
        pendingScheduledAtMs = getNow()

        if (typeof window === "undefined") {
            const computeStartMs = getNow()
            const visibleLineCount = computeAndPublish(editorState)
            if (DEBUG_ENTER_FOLDING_PROFILE && reason === "enter") {
                log("enterUpdateProfile", {
                    editorKey: editor.getKey(),
                    mode: "sync",
                    visibleLineCount,
                    computeMs: Number((getNow() - computeStartMs).toFixed(2)),
                })
            }
            pendingEditorState = null
            return
        }

        // Always cancel and reschedule so we never drop a recompute.
        // The pending state is already updated above, so the new rAF
        // will use the latest editor state.
        cancelPendingRaf()

        // Double-rAF: first rAF fires before browser paint (DOM is still dirty
        // from Lexical reconciliation). Reading offsetTop/offsetHeight there forces
        // synchronous layout. Second rAF fires after the browser has painted, so
        // the layout is already clean and reads are cheap.
        rafId = window.requestAnimationFrame(() => {
            rafId = window.requestAnimationFrame(() => {
                rafId = null
                const nextState = pendingEditorState
                const nextReason = pendingReason
                const scheduledAtMs = pendingScheduledAtMs
                pendingEditorState = null
                pendingReason = "regular"
                pendingScheduledAtMs = 0
                if (!nextState) {
                    return
                }
                const computeStartMs = getNow()
                const visibleLineCount = computeAndPublish(nextState)
                const computeMs = getNow() - computeStartMs
                if (DEBUG_ENTER_FOLDING_PROFILE && nextReason === "enter") {
                    log("enterUpdateProfile", {
                        editorKey: editor.getKey(),
                        mode: "double-raf",
                        visibleLineCount,
                        computeMs: Number(computeMs.toFixed(2)),
                        waitMs: Number((computeStartMs - scheduledAtMs).toFixed(2)),
                        totalMs: Number((getNow() - scheduledAtMs).toFixed(2)),
                    })
                }
            })
        })
    }

    const handleRootScroll = () => {
        scheduleCompute(editor.getEditorState())
    }

    // Track all attached scroll listeners for cleanup
    let scrollListenerTargets: HTMLElement[] = []

    const detachScrollListeners = () => {
        for (const el of scrollListenerTargets) {
            el.removeEventListener("scroll", handleRootScroll)
        }
        scrollListenerTargets = []
    }

    const attachScrollListeners = (root: HTMLElement | null) => {
        detachScrollListeners()
        if (!root) return

        const targets: HTMLElement[] = [root]

        // Also listen on the nearest scrollable ancestor (.editor-inner etc.)
        // because the root contentEditable may not be the scroll container.
        let ancestor = root.parentElement
        while (ancestor) {
            const style = window.getComputedStyle(ancestor)
            const overflowY = style.overflowY
            if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
                if (!targets.includes(ancestor)) {
                    targets.push(ancestor)
                }
                break
            }
            ancestor = ancestor.parentElement
        }

        for (const el of targets) {
            el.addEventListener("scroll", handleRootScroll, {passive: true})
        }
        scrollListenerTargets = targets
    }

    const unregisterNodeTransform = editor.registerNodeTransform(CodeLineNode, (line) => {
        if ($hasUpdateTag("agenta:bulk-clear")) {
            return
        }
        if ($hasUpdateTag(ENTER_KEY_UPDATE_TAG)) {
            return
        }
        if ($hasUpdateTag(FOLD_UPDATE_TAG)) {
            return
        }
        if ($hasUpdateTag("segment-rebalance")) {
            return
        }
        const parent = $getCodeBlockForLine(line)
        if (!parent) {
            return
        }

        if ($getLineCount(parent) > MAX_LINES_FOR_FOLDING_OVERLAY) {
            // For large documents folding overlays are disabled; keep transform work minimal.
            if (line.isFoldable()) {
                line.setFoldable(false)
            }
            if (line.isCollapsed()) {
                line.setCollapsed(false)
            }
            return
        }

        const language = parent.getLanguage()
        const text = line.getTextContent()
        const foldable = isFoldableLine(text, language)

        if (foldable !== line.isFoldable()) {
            line.setFoldable(foldable)
        }
        if (!foldable && line.isCollapsed()) {
            line.setCollapsed(false)
        }
    })

    // ------------------------------------------------------------------
    // Mutation listener: fires whenever CodeLineNodes are created,
    // destroyed, or updated in the DOM. This is the most reliable
    // trigger for repositioning fold overlay buttons after Enter
    // (line insertion), Backspace (line deletion), paste, etc.
    // ------------------------------------------------------------------
    const unregisterMutationListener = editor.registerMutationListener(
        CodeLineNode,
        (mutations) => {
            let created = 0
            let destroyed = 0
            for (const [, type] of mutations) {
                if (type === "created") created++
                if (type === "destroyed") destroyed++
            }
            if (created > 0 || destroyed > 0) {
                scheduleCompute(editor.getEditorState(), "enter")
            }
        },
        {skipInitialization: true},
    )

    const unregisterUpdateListener = editor.registerUpdateListener(
        ({editorState, dirtyElements, dirtyLeaves, tags}) => {
            if (dirtyElements.size === 0 && dirtyLeaves.size === 0) {
                return
            }

            // ----------------------------------------------------------
            // FOLD UPDATE: apply class changes synchronously.
            // This runs AFTER Lexical reconciliation, so the fold icon
            // DOM update is already done. We only write classes (no
            // geometry reads) so there's no forced reflow.
            // ----------------------------------------------------------
            if (tags.has(FOLD_UPDATE_TAG) && pendingFoldToggle) {
                const toggle = pendingFoldToggle
                pendingFoldToggle = null
                applyFoldClassChanges(editor, toggle)
                scheduleCompute(editorState, "regular")
                return
            }

            if (tags.has("segment-rebalance")) {
                return
            }

            scheduleCompute(editorState, "regular")
        },
    )

    const unregisterRootListener = editor.registerRootListener((nextRoot, prevRoot) => {
        if (attachedRoot === prevRoot) {
            detachScrollListeners()
            attachedRoot = null
        }

        if (nextRoot) {
            attachScrollListeners(nextRoot)
            attachedRoot = nextRoot
        }

        scheduleCompute(editor.getEditorState())
    })

    const initialEditorState = editor.getEditorState()
    const initialRoot = editor.getRootElement()
    if (initialRoot) {
        attachScrollListeners(initialRoot)
        attachedRoot = initialRoot
    }
    computeAndPublish(initialEditorState)

    return () => {
        if (rafId !== null && typeof window !== "undefined") {
            window.cancelAnimationFrame(rafId)
            rafId = null
        }
        pendingEditorState = null
        pendingFoldToggle = null
        detachScrollListeners()
        attachedRoot = null
        unregisterRootListener()
        unregisterNodeTransform()
        unregisterMutationListener()
        unregisterUpdateListener()
    }
}
