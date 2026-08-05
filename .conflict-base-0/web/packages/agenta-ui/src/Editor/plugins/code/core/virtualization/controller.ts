import {createLogger} from "@agenta/shared/utils"
import {
    $getRoot,
    $getSelection,
    $isRangeSelection,
    type EditorState,
    type LexicalEditor,
    type LexicalNode,
} from "lexical"

import {$isCodeBlockNode} from "../../nodes/CodeBlockNode"
import {$isCodeLineNode, type CodeLineNode} from "../../nodes/CodeLineNode"
import {disconnectLexicalObserver} from "../../utils/lexicalObserver"
import {$getGlobalLineIndex, $getLineCount, $rebalanceSegments} from "../../utils/segmentUtils"
import {FOLD_UPDATE_TAG} from "../folding/controller"
import {ENTER_KEY_UPDATE_TAG, enterKeyTimestamp} from "../highlight/updateTags"

const log = createLogger("CodeVirtualizationCore", {disabled: true})
const DEBUG_VIRTUALIZATION_LOGS = false

const VIRTUAL_HIDDEN_CLASS = "virtual-hidden"
const DEFAULT_LINE_THRESHOLD = 1200
const DEFAULT_OVERSCAN_LINES = 180
const DEFAULT_ACTIVE_LINE_OVERSCAN = 220
const DEFAULT_ESTIMATED_LINE_HEIGHT = 24
const DEFAULT_MIN_VISIBLE_LINES = 120

/**
 * WeakMap cache for detached DOM children of hidden lines.
 * When a line is hidden, its child spans are moved into a DocumentFragment
 * cached here. When the line becomes visible again, the fragment is
 * re-attached. This reduces the live DOM from ~65k to ~8k nodes for
 * a 5400-line document, making Lexical reconciliation iterations and
 * browser layout significantly cheaper.
 *
 * Using WeakMap so entries are GC'd if the line element is removed from the DOM.
 */
const detachedChildrenCache = new WeakMap<HTMLElement, DocumentFragment>()

declare global {
    interface Window {
        __AGENTA_EDITOR_VIRTUAL_DEBUG__?: boolean
    }
}

interface RegisterCodeVirtualizationCoreConfig {
    lineThreshold?: number
    overscanLines?: number
    activeLineOverscan?: number
    estimatedLineHeight?: number
    minVisibleLines?: number
    freezeWindowOnScroll?: boolean
}

function getCodeLineAncestor(node: LexicalNode | null): CodeLineNode | null {
    let current = node
    while (current) {
        if ($isCodeLineNode(current)) {
            return current
        }
        current = current.getParent()
    }
    return null
}

function getViewportHeight(candidates: HTMLElement[]): number {
    for (const element of candidates) {
        if (element.clientHeight > 0) {
            return element.clientHeight
        }
    }
    return 0
}

function isVirtualizationDebugEnabled(): boolean {
    if (DEBUG_VIRTUALIZATION_LOGS) {
        return true
    }
    if (typeof window === "undefined") {
        return false
    }
    return window.__AGENTA_EDITOR_VIRTUAL_DEBUG__ === true
}

function describeElement(element: HTMLElement | null): string {
    if (!element) {
        return "null"
    }
    const idPart = element.id ? `#${element.id}` : ""
    const classPart = element.className
        ? `.${String(element.className).trim().split(/\s+/).filter(Boolean).slice(0, 3).join(".")}`
        : ""
    return `${element.tagName.toLowerCase()}${idPart}${classPart}`
}

function hasScrollableOverflowY(element: HTMLElement): boolean {
    const computedStyle = window.getComputedStyle(element)
    const overflowY = computedStyle.overflowY
    return overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay"
}

function isScrollableY(element: HTMLElement): boolean {
    return hasScrollableOverflowY(element) && element.scrollHeight > element.clientHeight + 1
}

function getNearestScrollableAncestor(element: HTMLElement | null): HTMLElement | null {
    let current = element?.parentElement ?? null
    while (current) {
        if (hasScrollableOverflowY(current)) {
            return current
        }
        current = current.parentElement
    }
    return null
}

/**
 * Collect ALL scrollable ancestors from `element` up to document.
 * This ensures that even when a nearer ancestor gains `overflow: auto` later
 * (e.g. `editor-inner` after large-doc-optimizations), we already have a
 * scroll listener on it.
 */
function getAllScrollableAncestors(element: HTMLElement | null): HTMLElement[] {
    const result: HTMLElement[] = []
    let current = element?.parentElement ?? null
    while (current) {
        if (hasScrollableOverflowY(current)) {
            result.push(current)
        }
        current = current.parentElement
    }
    return result
}

/**
 * Collect known ancestor elements that MAY become scroll containers after
 * CSS class/style changes (e.g. `editor-inner` gaining `overflow: auto`
 * when large-doc-optimizations activates). We attach scroll listeners
 * proactively so events are captured immediately when overflow kicks in.
 */
function getPotentialScrollContainers(root: HTMLElement | null): HTMLElement[] {
    if (!root) return []
    const result: HTMLElement[] = []
    // editor-inner: gets overflow:auto when large-doc-optimizations class is added
    const editorInner = root.closest<HTMLElement>(".editor-inner")
    if (editorInner) result.push(editorInner)
    // Ant Design modal wrap: has overflow:auto and is the outermost scroll container in modals
    const modalWrap = root.closest<HTMLElement>(".ant-modal-wrap")
    if (modalWrap) result.push(modalWrap)
    return result
}

function uniqueElements(elements: (HTMLElement | null | undefined)[]): HTMLElement[] {
    const unique: HTMLElement[] = []
    elements.forEach((element) => {
        if (!element || unique.includes(element)) {
            return
        }
        unique.push(element)
    })
    return unique
}

function sameElements(a: HTMLElement[], b: HTMLElement[]): boolean {
    if (a.length !== b.length) {
        return false
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false
        }
    }
    return true
}

/**
 * Binary search through contiguous line elements to find the first line
 * whose bottom edge is at or below `viewportTop`. This is the first line
 * that is (at least partially) visible in the scroll container.
 *
 * Works with variable-height lines (e.g. when wrapping is enabled).
 * Callers must ensure the range [searchStart, searchEnd] contains only
 * visible (non-hidden) elements so getBoundingClientRect returns valid rects.
 */
function findLineAtViewportTop(
    lineElements: HTMLElement[],
    searchStart: number,
    searchEnd: number,
    viewportTop: number,
): number {
    let lo = searchStart
    let hi = searchEnd
    let result = searchStart

    while (lo <= hi) {
        const mid = (lo + hi) >>> 1
        const el = lineElements[mid]
        if (!el) {
            lo = mid + 1
            continue
        }
        const rect = el.getBoundingClientRect()
        if (rect.bottom <= viewportTop) {
            lo = mid + 1
        } else {
            result = mid
            hi = mid - 1
        }
    }
    return result
}

export function registerCodeVirtualizationCore(
    editor: LexicalEditor,
    {
        lineThreshold = DEFAULT_LINE_THRESHOLD,
        overscanLines = DEFAULT_OVERSCAN_LINES,
        activeLineOverscan = DEFAULT_ACTIVE_LINE_OVERSCAN,
        estimatedLineHeight = DEFAULT_ESTIMATED_LINE_HEIGHT,
        minVisibleLines = DEFAULT_MIN_VISIBLE_LINES,
        freezeWindowOnScroll = false,
    }: RegisterCodeVirtualizationCoreConfig = {},
): () => void {
    const debugLog = (event: string, payload: Record<string, unknown>) => {
        if (!isVirtualizationDebugEnabled()) {
            return
        }
        log(event, payload)
    }

    let rafId: number | null = null
    let pendingEditorState: EditorState | null = null
    let active = false
    let rootElement: HTMLElement | null = null
    let codeElement: HTMLElement | null = null
    let preferredScrollElement: HTMLElement | null = null
    let scrollTargets: HTMLElement[] = []
    let measuredLineHeight = estimatedLineHeight
    let previousRangeStart = -1
    let previousRangeEnd = -1
    let previousTotalLines = -1
    // Cached viewport measurements — reading clientHeight/scrollHeight/
    // getBoundingClientRect forces synchronous layout on a dirty DOM.
    // These values change only on scroll or resize, not on Enter key.
    let cachedActiveScrollElement: HTMLElement | null = null
    let cachedViewportHeight = 0
    // Cached offset between root and scroll container for scrollTop calculation.
    // getBoundingClientRect() is the most expensive forced-reflow trigger.
    let cachedRootTopOffset: number | null = null

    // Track which element currently has counter-set so we can clear it.
    let counterSetElement: HTMLElement | null = null

    // Elements pending deferred child detachment.
    let pendingDetachElements: HTMLElement[] = []
    let detachIdleId: ReturnType<typeof requestIdleCallback> | null = null

    const flushPendingDetach = () => {
        if (pendingDetachElements.length === 0) return
        const {reconnect} = disconnectLexicalObserver(editor)
        try {
            for (const el of pendingDetachElements) {
                // Only detach if still hidden and not already cached.
                if (
                    el.classList.contains(VIRTUAL_HIDDEN_CLASS) &&
                    !detachedChildrenCache.has(el) &&
                    el.childNodes.length > 0
                ) {
                    const fragment = document.createDocumentFragment()
                    while (el.firstChild) {
                        fragment.appendChild(el.firstChild)
                    }
                    detachedChildrenCache.set(el, fragment)
                }
            }
        } finally {
            reconnect()
        }
        pendingDetachElements = []
    }

    const scheduleDeferredDetach = () => {
        if (typeof requestIdleCallback === "undefined") {
            // Fallback: use setTimeout with a short delay
            setTimeout(flushPendingDetach, 100)
            return
        }
        if (detachIdleId != null) cancelIdleCallback(detachIdleId)
        detachIdleId = requestIdleCallback(
            () => {
                detachIdleId = null
                flushPendingDetach()
            },
            {timeout: 500},
        )
    }

    const setHiddenRange = (
        lineElements: HTMLElement[],
        fromInclusive: number,
        toInclusive: number,
        hidden: boolean,
        deferDetach = false,
    ) => {
        if (fromInclusive > toInclusive) {
            return
        }
        const start = Math.max(0, fromInclusive)
        const end = Math.min(lineElements.length - 1, toInclusive)
        if (start > end) {
            return
        }
        for (let i = start; i <= end; i++) {
            const el = lineElements[i]
            if (!el) continue
            el.classList.toggle(VIRTUAL_HIDDEN_CLASS, hidden)

            if (hidden) {
                if (deferDetach) {
                    // Defer child detachment to idle time — keeps the class toggle
                    // fast (~0.01ms/el) while reducing DOM weight later.
                    pendingDetachElements.push(el)
                } else {
                    // Detach child spans from hidden lines to reduce live DOM node count.
                    if (!detachedChildrenCache.has(el) && el.childNodes.length > 0) {
                        const fragment = document.createDocumentFragment()
                        while (el.firstChild) {
                            fragment.appendChild(el.firstChild)
                        }
                        detachedChildrenCache.set(el, fragment)
                    }
                }
            } else {
                // Re-attach cached children when line becomes visible.
                const cached = detachedChildrenCache.get(el)
                if (cached) {
                    el.appendChild(cached)
                    detachedChildrenCache.delete(el)
                }
            }
        }
    }

    /**
     * Fix CSS counter line numbers when virtualization hides lines.
     * Hidden lines (display: none) are removed from CSS counter flow,
     * so visible lines would restart counting from 1. We use `counter-set`
     * on the first visible line to initialize the counter to the correct value.
     *
     * Uses style.setProperty/removeProperty to avoid TS type issues with
     * the `counterSet` property which may not be in all lib.dom typings.
     */
    const fixLineNumberCounter = (lineElements: HTMLElement[], rangeStart: number) => {
        const firstVisibleEl = lineElements[rangeStart]
        if (!firstVisibleEl) return

        if (counterSetElement && counterSetElement !== firstVisibleEl) {
            counterSetElement.style.removeProperty("counter-set")
            counterSetElement = null
        }

        if (rangeStart > 0) {
            // counter-set sets the counter value BEFORE counter-increment runs.
            // Since ::before has counter-increment, the displayed value will be
            // rangeStart + 1 (1-indexed), which is correct.
            firstVisibleEl.style.setProperty("counter-set", `line-number ${rangeStart}`)
            counterSetElement = firstVisibleEl
        } else if (counterSetElement) {
            counterSetElement.style.removeProperty("counter-set")
            counterSetElement = null
        }
    }

    const resetVirtualization = () => {
        // Only do expensive DOM cleanup when virtualization was actually active.
        // Without this guard, every fold toggle triggers a 5400-element traversal
        // even when no lines have virtual-hidden classes or detached children.
        if (active && codeElement) {
            const {reconnect} = disconnectLexicalObserver(editor)
            try {
                // Only query lines that are actually virtual-hidden — much cheaper
                // than iterating all 5400 lines when most are folded.
                const hiddenLines = codeElement.querySelectorAll<HTMLElement>(
                    "div.editor-code-line.virtual-hidden",
                )
                hiddenLines.forEach((line) => {
                    const cached = detachedChildrenCache.get(line)
                    if (cached) {
                        line.appendChild(cached)
                        detachedChildrenCache.delete(line)
                    }
                    line.classList.remove(VIRTUAL_HIDDEN_CLASS)
                })
            } finally {
                reconnect()
            }
            codeElement.style.paddingTop = ""
            codeElement.style.paddingBottom = ""
        }

        // Clear counter-set from the previously set element
        if (counterSetElement) {
            counterSetElement.style.removeProperty("counter-set")
            counterSetElement = null
        }

        if (active) {
            active = false
            previousRangeStart = -1
            previousRangeEnd = -1
            previousTotalLines = -1
            invalidateViewportCache()
            debugLog("disabled", {editorKey: editor.getKey()})
        }
    }

    const computeAndApply = (
        editorState: EditorState,
        deferDetach = false,
        scrollTriggered = false,
    ) => {
        const _t0 = performance.now()
        const root = editor.getRootElement()
        if (!root) {
            resetVirtualization()
            return
        }

        rootElement = root
        codeElement = root.querySelector<HTMLElement>(".editor-code")
        if (!codeElement) {
            resetVirtualization()
            return
        }

        let totalLines = 0
        let activeLineIndex: number | null = null
        editorState.read(() => {
            const rootNode = $getRoot()
            const codeBlock = rootNode.getChildren().find($isCodeBlockNode)
            if ($isCodeBlockNode(codeBlock)) {
                totalLines = $getLineCount(codeBlock)
            }

            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
                const anchorLine = getCodeLineAncestor(selection.anchor.getNode())
                const focusLine = getCodeLineAncestor(selection.focus.getNode())
                const line = anchorLine ?? focusLine
                if (line) {
                    activeLineIndex = $getGlobalLineIndex(line)
                }
            }
        })

        if (totalLines < lineThreshold) {
            debugLog("skipBelowThreshold", {
                editorKey: editor.getKey(),
                totalLines,
                lineThreshold,
            })
            resetVirtualization()
            return
        }

        // NOTE: the actual threshold check against visible lines (domLineCount)
        // happens after querySelectorAll below, since folded lines are excluded.

        const _t1 = performance.now()
        // Exclude folded lines from virtualization. Folded lines are already
        // `display: none` via the `folded` CSS class and cost nothing for layout.
        // Including them would cause virtualization to hide non-folded content
        // beyond the visible range (e.g., closing brackets after a large fold).
        const lineElements = Array.from(
            codeElement.querySelectorAll<HTMLElement>("div.editor-code-line:not(.folded)"),
        )
        const _t2 = performance.now()
        if (lineElements.length === 0) {
            resetVirtualization()
            return
        }

        const domLineCount = lineElements.length

        // When most lines are folded, the remaining visible lines are few
        // enough that virtualization isn't needed. Deactivate to avoid
        // incorrectly hiding non-folded content.
        if (domLineCount < lineThreshold) {
            resetVirtualization()
            return
        }

        // -----------------------------------------------------------
        // Detect scroll container changes (e.g. large-doc-optimizations
        // adding overflow:auto to editor-inner after initial activation).
        // If the nearest scrollable ancestor changed, we must run the
        // full path to rebind scroll listeners and re-measure the viewport.
        // -----------------------------------------------------------
        let scrollContainerChanged = false
        if (active) {
            const currentNearestScroller = getNearestScrollableAncestor(rootElement)
            if (currentNearestScroller && currentNearestScroller !== preferredScrollElement) {
                scrollContainerChanged = true
                // Update preferred to the closer scroller so viewport math uses it
                preferredScrollElement = currentNearestScroller
                invalidateViewportCache()
                // Ensure the new scroller is in our target list
                if (!scrollTargets.includes(currentNearestScroller)) {
                    currentNearestScroller.addEventListener("scroll", handleScroll, {passive: true})
                    scrollTargets.push(currentNearestScroller)
                }
            }
        }

        // -----------------------------------------------------------
        // FAST PATH: incremental update (Enter key, small delta)
        // When virtualization is already active and only 1-2 lines changed,
        // compute the new range from the PREVIOUS range + activeLineIndex
        // without reading ANY DOM geometry properties.  Every geometry read
        // (offsetHeight, scrollTop, clientHeight, getBoundingClientRect)
        // forces the browser to synchronously lay out the entire ~65k-node
        // DOM tree — the 1100ms+ "forced reflow" bottleneck.
        // -----------------------------------------------------------
        const lineCountDelta = previousTotalLines >= 0 ? domLineCount - previousTotalLines : 0
        const canUseFastPath =
            !scrollTriggered &&
            !scrollContainerChanged &&
            active &&
            previousRangeStart >= 0 &&
            previousRangeEnd >= 0 &&
            Math.abs(lineCountDelta) <= 2 &&
            activeLineIndex != null

        if (canUseFastPath) {
            // Extend the previous range by the line count delta (usually +1)
            // and ensure the active line is within the overscan window.
            let rangeStart = previousRangeStart
            let rangeEnd = Math.min(domLineCount - 1, previousRangeEnd + lineCountDelta)

            // Pin to active line with overscan
            rangeStart = Math.min(rangeStart, Math.max(0, activeLineIndex! - activeLineOverscan))
            rangeEnd = Math.max(
                rangeEnd,
                Math.min(domLineCount - 1, activeLineIndex! + activeLineOverscan),
            )

            if (rangeStart === previousRangeStart && rangeEnd === previousRangeEnd) {
                // The new line is already within the visible window — just
                // ensure it's not hidden and update the padding.
                const newLineIdx = activeLineIndex!
                if (newLineIdx >= 0 && newLineIdx < domLineCount) {
                    const el = lineElements[newLineIdx]
                    if (el?.classList.contains(VIRTUAL_HIDDEN_CLASS)) {
                        const {reconnect} = disconnectLexicalObserver(editor)
                        try {
                            setHiddenRange(lineElements, newLineIdx, newLineIdx, false)
                        } finally {
                            reconnect()
                        }
                    }
                }
            } else {
                // Incremental range update — only toggle at the edges.
                const {reconnect} = disconnectLexicalObserver(editor)
                try {
                    if (rangeStart > previousRangeStart) {
                        setHiddenRange(lineElements, previousRangeStart, rangeStart - 1, true)
                    } else if (rangeStart < previousRangeStart) {
                        setHiddenRange(lineElements, rangeStart, previousRangeStart - 1, false)
                    }
                    if (rangeEnd < previousRangeEnd) {
                        setHiddenRange(lineElements, rangeEnd + 1, previousRangeEnd, true)
                    } else if (rangeEnd > previousRangeEnd) {
                        setHiddenRange(lineElements, previousRangeEnd + 1, rangeEnd, false)
                    }
                    // Ensure the new line element itself is visible
                    if (activeLineIndex! >= rangeStart && activeLineIndex! <= rangeEnd) {
                        setHiddenRange(lineElements, activeLineIndex!, activeLineIndex!, false)
                    }
                } finally {
                    reconnect()
                }
            }

            // Update padding for hidden lines
            codeElement.style.paddingTop = `${Math.max(0, rangeStart * measuredLineHeight)}px`
            codeElement.style.paddingBottom = `${Math.max(
                0,
                (domLineCount - rangeEnd - 1) * measuredLineHeight,
            )}px`

            // Fix CSS counter so line numbers display correctly
            fixLineNumberCounter(lineElements, rangeStart)

            previousRangeStart = rangeStart
            previousRangeEnd = rangeEnd
            previousTotalLines = domLineCount

            const _tFast = performance.now()
            // console.log("computeAndApply:fastPath", {
            //     totalMs: Number((_tFast - _t0).toFixed(2)),
            //     stateReadMs: Number((_t1 - _t0).toFixed(2)),
            //     querySelectorMs: Number((_t2 - _t1).toFixed(2)),
            //     rangeStart,
            //     rangeEnd,
            //     activeLineIndex,
            //     lineCountDelta,
            // })
            return
        }

        // -----------------------------------------------------------
        // FULL PATH: initial activation, large changes, scroll-driven
        // This reads DOM geometry (may force reflow) but only runs when
        // virtualization is first set up or on scroll/resize.
        // -----------------------------------------------------------

        // Only measure when we don't have a valid value yet. Sample
        // multiple lines to get a better average when wrapping is active.
        if (measuredLineHeight <= 0) {
            const sampleCount = Math.min(50, lineElements.length)
            let totalHeight = 0
            let measured = 0
            for (let i = 0; i < sampleCount; i++) {
                const el = lineElements[i]
                if (el && !el.classList.contains("folded") && el.offsetHeight > 0) {
                    totalHeight += el.offsetHeight
                    measured++
                }
            }
            measuredLineHeight = measured > 0 ? totalHeight / measured : estimatedLineHeight
        }

        const viewportCandidates = uniqueElements([
            preferredScrollElement,
            rootElement,
            codeElement,
            ...scrollTargets,
        ])

        let activeScrollElement: HTMLElement | null
        let viewportHeight: number
        if (cachedActiveScrollElement && cachedViewportHeight > 0) {
            activeScrollElement = cachedActiveScrollElement
            viewportHeight = cachedViewportHeight
        } else {
            activeScrollElement =
                viewportCandidates.find((element) => isScrollableY(element)) ??
                preferredScrollElement ??
                rootElement
            viewportHeight = getViewportHeight(viewportCandidates)
            cachedActiveScrollElement = activeScrollElement
            cachedViewportHeight = viewportHeight
        }

        const effectiveViewportLines = Math.max(
            minVisibleLines,
            Math.ceil(
                (viewportHeight || measuredLineHeight * minVisibleLines) / measuredLineHeight,
            ),
        )

        let scrollTop: number
        if (!activeScrollElement || activeScrollElement === rootElement) {
            scrollTop = rootElement.scrollTop
        } else if (cachedRootTopOffset !== null) {
            scrollTop = Math.max(0, activeScrollElement.scrollTop - cachedRootTopOffset)
        } else {
            const rootRect = rootElement.getBoundingClientRect()
            const scrollRect = activeScrollElement.getBoundingClientRect()
            cachedRootTopOffset = rootRect.top - scrollRect.top + activeScrollElement.scrollTop
            scrollTop = Math.max(0, activeScrollElement.scrollTop - cachedRootTopOffset)
        }

        // Find which line is at the top of the viewport.
        // When virtualization is already active, use DOM measurement (binary
        // search) to handle variable-height lines from wrapping correctly.
        // On first activation, use the height-based estimate since all lines
        // are visible and the average height is measured from multiple samples.
        let viewportLineIndex: number
        if (active && activeScrollElement && previousRangeStart >= 0) {
            const scrollRect = activeScrollElement.getBoundingClientRect()
            viewportLineIndex = findLineAtViewportTop(
                lineElements,
                previousRangeStart,
                Math.min(previousRangeEnd, domLineCount - 1),
                scrollRect.top,
            )
        } else {
            viewportLineIndex = Math.floor(scrollTop / measuredLineHeight)
        }

        const baseRangeStart = Math.max(0, viewportLineIndex - overscanLines)
        const baseRangeEnd = Math.min(
            domLineCount - 1,
            baseRangeStart + effectiveViewportLines + overscanLines * 2 - 1,
        )
        let rangeStart = baseRangeStart
        let rangeEnd = baseRangeEnd

        if (activeLineIndex != null) {
            const isActiveLineNearViewport =
                activeLineIndex >= baseRangeStart - overscanLines &&
                activeLineIndex <= baseRangeEnd + overscanLines
            if (isActiveLineNearViewport) {
                rangeStart = Math.min(rangeStart, Math.max(0, activeLineIndex - activeLineOverscan))
                rangeEnd = Math.max(
                    rangeEnd,
                    Math.min(domLineCount - 1, activeLineIndex + activeLineOverscan),
                )
            }
        }

        if (
            active &&
            previousRangeStart === rangeStart &&
            previousRangeEnd === rangeEnd &&
            previousTotalLines === domLineCount
        ) {
            return
        }

        const shouldRunFullPass = !active || previousTotalLines !== domLineCount

        const {reconnect} = disconnectLexicalObserver(editor)
        try {
            if (shouldRunFullPass) {
                setHiddenRange(lineElements, 0, rangeStart - 1, true, deferDetach)
                setHiddenRange(lineElements, rangeStart, rangeEnd, false)
                setHiddenRange(lineElements, rangeEnd + 1, domLineCount - 1, true, deferDetach)
            } else {
                if (rangeStart > previousRangeStart) {
                    setHiddenRange(lineElements, previousRangeStart, rangeStart - 1, true)
                } else if (rangeStart < previousRangeStart) {
                    setHiddenRange(lineElements, rangeStart, previousRangeStart - 1, false)
                }
                if (rangeEnd < previousRangeEnd) {
                    setHiddenRange(lineElements, rangeEnd + 1, previousRangeEnd, true)
                } else if (rangeEnd > previousRangeEnd) {
                    setHiddenRange(lineElements, previousRangeEnd + 1, rangeEnd, false)
                }
            }
        } finally {
            reconnect()
        }

        if (deferDetach && pendingDetachElements.length > 0) {
            scheduleDeferredDetach()
        }

        const _tFull = performance.now()
        // console.log("computeAndApply:fullPath", {
        //     totalMs: Number((_tFull - _t0).toFixed(2)),
        //     domLineCount,
        //     rangeStart,
        //     rangeEnd,
        //     visibleLines: rangeEnd - rangeStart + 1,
        //     fullPass: shouldRunFullPass,
        // })

        // Preserve scroll space for hidden lines.
        // NOTE: measuredLineHeight is measured once during initial activation
        // (sampled from the first 50 lines). We intentionally do NOT update it
        // on every scroll — doing so creates a feedback loop: different visible
        // ranges have different average heights, causing padding to shift,
        // which triggers another scroll event, ad infinitum (the "wiggle" bug).
        // With 180 lines of overscan, small padding inaccuracies are invisible.
        codeElement.style.paddingTop = `${Math.max(0, rangeStart * measuredLineHeight)}px`
        codeElement.style.paddingBottom = `${Math.max(
            0,
            (domLineCount - rangeEnd - 1) * measuredLineHeight,
        )}px`

        // Fix CSS counter so line numbers display correctly
        fixLineNumberCounter(lineElements, rangeStart)

        active = true
        previousRangeStart = rangeStart
        previousRangeEnd = rangeEnd
        previousTotalLines = domLineCount

        debugLog("applyWindow", {
            editorKey: editor.getKey(),
            totalLines,
            domLineCount,
            rangeStart,
            rangeEnd,
            visibleLineCount: rangeEnd - rangeStart + 1,
            hiddenLineCount: Math.max(0, domLineCount - (rangeEnd - rangeStart + 1)),
            activeLineIndex,
            fullPass: shouldRunFullPass,
            measuredLineHeight,
        })
    }

    let pendingDeferDetach = false
    /** Set by handleScroll to force the full path (DOM geometry re-read). */
    let pendingScrollTriggered = false

    const scheduleCompute = (editorState: EditorState, deferDetach = false) => {
        pendingEditorState = editorState
        if (deferDetach) pendingDeferDetach = true
        if (typeof window === "undefined") {
            computeAndApply(editorState, pendingDeferDetach)
            pendingEditorState = null
            pendingDeferDetach = false
            pendingScrollTriggered = false
            return
        }
        if (rafId != null) {
            return
        }
        rafId = window.requestAnimationFrame(() => {
            rafId = null
            const nextState = pendingEditorState
            const nextDefer = pendingDeferDetach
            const nextScrollTriggered = pendingScrollTriggered
            pendingEditorState = null
            pendingDeferDetach = false
            pendingScrollTriggered = false
            if (!nextState) {
                return
            }
            computeAndApply(nextState, nextDefer, nextScrollTriggered)
        })
    }

    const invalidateViewportCache = () => {
        cachedActiveScrollElement = null
        cachedViewportHeight = 0
        cachedRootTopOffset = null
    }

    const handleScroll = () => {
        if (freezeWindowOnScroll) {
            return
        }
        // Invalidate viewport cache — on scroll the DOM is clean so
        // re-measuring is cheap (no forced reflow).
        invalidateViewportCache()
        // Mark as scroll-triggered so computeAndApply skips the fast path
        // and re-reads DOM geometry to compute the correct visible range.
        pendingScrollTriggered = true
        scheduleCompute(editor.getEditorState())
    }

    const detachScrollTargets = () => {
        scrollTargets.forEach((element) => {
            element.removeEventListener("scroll", handleScroll)
        })
        scrollTargets = []
    }

    const refreshScrollTargets = () => {
        // Root changed — scroll container may have changed too
        invalidateViewportCache()
        const root = editor.getRootElement()
        const code = root?.querySelector<HTMLElement>(".editor-code") ?? null
        const nearestRootScroller = getNearestScrollableAncestor(root)
        const nearestCodeScroller = getNearestScrollableAncestor(code)
        // Collect ALL scrollable ancestors (not just nearest) so that when
        // an intermediate ancestor gains overflow:auto later (e.g. editor-inner
        // after large-doc-optimizations), we already have a listener on it.
        const allRootScrollers = getAllScrollableAncestors(root)
        // Also add known elements that MAY become scrollable (e.g. editor-inner
        // before large-doc mode adds overflow:auto). addEventListener on a
        // non-scrollable element is harmless — events simply don't fire until
        // the element becomes scrollable.
        const potentialContainers = getPotentialScrollContainers(root)
        const nextTargets = uniqueElements([
            root,
            code,
            root?.parentElement ?? null,
            root?.parentElement?.parentElement ?? null,
            nearestRootScroller,
            nearestCodeScroller,
            ...allRootScrollers,
            ...potentialContainers,
        ])

        preferredScrollElement =
            nearestRootScroller ??
            nearestCodeScroller ??
            root?.parentElement ??
            root ??
            code ??
            null

        debugLog("scrollTargets", {
            editorKey: editor.getKey(),
            preferredScrollElement: describeElement(preferredScrollElement),
            targets: nextTargets.map(describeElement),
        })

        if (sameElements(scrollTargets, nextTargets)) {
            return
        }

        detachScrollTargets()
        nextTargets.forEach((element) => {
            element.addEventListener("scroll", handleScroll, {passive: true})
        })
        scrollTargets = nextTargets
    }

    refreshScrollTargets()
    debugLog("register", {
        editorKey: editor.getKey(),
        lineThreshold,
        overscanLines,
        activeLineOverscan,
        estimatedLineHeight,
        minVisibleLines,
        freezeWindowOnScroll,
    })
    scheduleCompute(editor.getEditorState())

    // Segment rebalancing — deferred to idle time after edits.
    // Splits oversized segments (>300 lines) and merges undersized adjacent
    // segments (combined ≤100 lines) to keep reconciliation cost stable.
    let rebalanceIdleId: ReturnType<typeof requestIdleCallback> | null = null

    function scheduleRebalance(): void {
        if (typeof requestIdleCallback === "undefined") return
        if (rebalanceIdleId != null) cancelIdleCallback(rebalanceIdleId)
        rebalanceIdleId = requestIdleCallback(
            () => {
                rebalanceIdleId = null
                editor.update(
                    () => {
                        const root = $getRoot()
                        for (const child of root.getChildren()) {
                            if ($isCodeBlockNode(child)) {
                                $rebalanceSegments(child)
                            }
                        }
                    },
                    {tag: "segment-rebalance", discrete: true},
                )
            },
            {timeout: 2000},
        )
    }

    const unregisterUpdate = editor.registerUpdateListener(
        ({editorState, dirtyElements, dirtyLeaves, tags}) => {
            if (dirtyElements.size === 0 && dirtyLeaves.size === 0) {
                return
            }

            // Skip updates triggered by segment rebalancing itself
            if (tags.has("segment-rebalance")) {
                scheduleCompute(editorState)
                return
            }

            // Diff initial content: large batch of lines was just created.
            // Run virtualization synchronously so lines beyond the viewport
            // are hidden BEFORE the browser's first paint — preventing a
            // multi-second freeze for 5k+ line diffs.
            if (tags.has("diff-initial-content")) {
                // Refresh scroll targets since the content may have made
                // ancestors scrollable for the first time
                invalidateViewportCache()
                refreshScrollTargets()
                // Cancel any pending rAF
                if (rafId != null && typeof window !== "undefined") {
                    window.cancelAnimationFrame(rafId)
                    rafId = null
                }
                pendingEditorState = null
                computeAndApply(editorState)
                return
            }

            // Fold class changes (.folded / .virtual-hidden) are applied
            // synchronously by the fold controller's update listener (which
            // fires before or after this one — order doesn't matter since
            // both run in the same microtask, before any rAF).
            // A single rAF is enough: by the time it fires, the browser has
            // painted the fold class changes, and geometry reads are cheap.
            if (tags.has(FOLD_UPDATE_TAG)) {
                requestAnimationFrame(() => {
                    computeAndApply(editor.getEditorState(), true)
                })
                return
            }

            const isEnterUpdate = tags.has(ENTER_KEY_UPDATE_TAG)

            if (isEnterUpdate) {
                const t0 = performance.now()
                // enterKeyTimestamp was set by the Enter command handler.
                // The gap t0 - enterKeyTimestamp = Lexical transforms + reconciliation + DOM selection.
                const _reconciliationMs =
                    enterKeyTimestamp > 0 ? Number((t0 - enterKeyTimestamp).toFixed(2)) : null
                // console.log("enterUpdateListener:start", {
                //     editorKey: editor.getKey(),
                //     active,
                //     dirtyElements: dirtyElements.size,
                //     dirtyLeaves: dirtyLeaves.size,
                //     reconciliationMs,
                // })

                // For Enter key updates, run virtualization synchronously so DOM
                // children are stripped from hidden lines BEFORE the browser's
                // layout/paint pass. Deferring to rAF means the browser paints
                // the full DOM first, then we strip — causing a visible freeze.
                if (active) {
                    // Cancel any pending rAF — we're running immediately
                    if (rafId != null && typeof window !== "undefined") {
                        window.cancelAnimationFrame(rafId)
                        rafId = null
                    }
                    pendingEditorState = null

                    const _tCA = performance.now()
                    computeAndApply(editorState)
                    // console.log("enterUpdateListener:computeAndApply", {
                    //     ms: Number((performance.now() - _tCA).toFixed(2)),
                    // })
                }

                const _listenerDurationMs = Number((performance.now() - t0).toFixed(2))
                performance.mark("agenta-enter-update-listener-end")
                // console.log("enterUpdateListener:end", {
                //     editorKey: editor.getKey(),
                //     listenerDurationMs,
                //     totalSinceEnterMs:
                //         enterKeyTimestamp > 0
                //             ? Number((performance.now() - enterKeyTimestamp).toFixed(2))
                //             : null,
                // })

                // Schedule a rAF to measure when the browser finishes paint
                const _rafStartMs = performance.now()
                // requestAnimationFrame(() => {
                //     performance.mark("agenta-enter-postraf")
                //     // console.log("enterUpdateListener:postRaf", {
                //         editorKey: editor.getKey(),
                //         layoutPaintMs: Number((performance.now() - rafStartMs).toFixed(2)),
                //         totalSinceEnterMs:
                //             enterKeyTimestamp > 0
                //                 ? Number((performance.now() - enterKeyTimestamp).toFixed(2))
                //                 : null,
                //     })
                // })

                // Defer segment rebalancing to idle time — never on the Enter path
                scheduleRebalance()
                return
            }

            scheduleCompute(editorState)
        },
    )

    const unregisterRoot = editor.registerRootListener(() => {
        refreshScrollTargets()
        scheduleCompute(editor.getEditorState())
    })

    return () => {
        if (rafId != null && typeof window !== "undefined") {
            window.cancelAnimationFrame(rafId)
            rafId = null
        }
        if (rebalanceIdleId != null && typeof cancelIdleCallback !== "undefined") {
            cancelIdleCallback(rebalanceIdleId)
            rebalanceIdleId = null
        }
        if (detachIdleId != null && typeof cancelIdleCallback !== "undefined") {
            cancelIdleCallback(detachIdleId)
            detachIdleId = null
        }
        pendingDetachElements = []
        pendingEditorState = null
        unregisterRoot()
        unregisterUpdate()
        detachScrollTargets()
        resetVirtualization()
    }
}
