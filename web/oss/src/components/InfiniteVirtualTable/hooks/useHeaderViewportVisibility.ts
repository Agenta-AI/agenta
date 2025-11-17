import {useCallback, useEffect, useMemo, useRef, type RefObject} from "react"

import type {ColumnViewportVisibilityEvent} from "../types"

type ViewportVisibilityCallback = (
    payload: ColumnViewportVisibilityEvent | ColumnViewportVisibilityEvent[],
) => void

// const intersectionThresholds = [0, 0.01, 0.02, 0.1]
const intersectionThresholds = [0, 0, 0, 0]

const parseRootMargin = (value?: string): [number, number, number, number] => {
    if (!value) {
        return [0, 160, 0, 160]
    }
    const parts = value
        .split(/\s+/)
        .map((part) => parseFloat(part.replace("px", "")))
        .filter((num) => Number.isFinite(num))
    if (!parts.length) {
        return [0, 160, 0, 160]
    }
    if (parts.length === 1) {
        return [parts[0], parts[0], parts[0], parts[0]]
    }
    if (parts.length === 2) {
        return [parts[0], parts[1], parts[0], parts[1]]
    }
    if (parts.length === 3) {
        return [parts[0], parts[1], parts[2], parts[1]]
    }
    return [parts[0], parts[1], parts[2], parts[3]]
}

const computeImmediateVisibility = (node: HTMLElement, root: Element | null, margin?: string) => {
    if (typeof window === "undefined") return true
    const rect = node.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
        return false
    }
    const [marginTop, marginRight, marginBottom, marginLeft] = parseRootMargin(margin)
    console.log("computeImmediateVisibility", {
        node,
        root,
        margin,
        rect,
        marginTop,
        marginRight,
        marginBottom,
        marginLeft,
    })
    if (root) {
        const rootRect = (root as HTMLElement).getBoundingClientRect()
        const expanded = {
            top: rootRect.top - marginTop,
            right: rootRect.right + marginRight,
            bottom: rootRect.bottom + marginBottom,
            left: rootRect.left - marginLeft,
        }
        return rect.right > expanded.left && rect.left < expanded.right
    }
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0
    const expandedViewport = {
        left: -marginLeft,
        right: viewportWidth + marginRight,
    }
    return rect.right > expandedViewport.left && rect.left < expandedViewport.right
}

const useHeaderViewportVisibility = ({
    scopeId,
    containerRef,
    onVisibilityChange,
    enabled = true,
    viewportMargin,
    exitDebounceMs = 150,
    excludeKeys = [],
    suspendUpdates = false,
    descendantColumnMap,
}: {
    scopeId: string | null
    containerRef: RefObject<HTMLDivElement | null>
    onVisibilityChange: ViewportVisibilityCallback | undefined
    enabled?: boolean
    viewportMargin?: string
    exitDebounceMs?: number
    excludeKeys?: string[]
    suspendUpdates?: boolean
    descendantColumnMap?: Map<string, string[]>
}) => {
    const excludedKeySet = useMemo(() => new Set(excludeKeys ?? []), [excludeKeys])
    const observerRef = useRef<IntersectionObserver | null>(null)
    const keyToElementRef = useRef(new Map<string, HTMLElement>())
    const elementToKeyRef = useRef(new Map<HTMLElement, string>())
    const fixedKeysRef = useRef(new Set<string>())
    const visibilityStateRef = useRef(new Map<string, boolean>())
    const queuedUpdatesRef = useRef<Map<string, boolean> | null>(null)
    const rafRef = useRef<number | null>(null)
    const hideTimeoutsRef = useRef(new Map<string, number>())
    const pendingUnregisterTimeoutsRef = useRef(new Map<string, number>())
    const suspendUpdatesRef = useRef(suspendUpdates)

    useEffect(() => {
        suspendUpdatesRef.current = suspendUpdates
    }, [suspendUpdates])

    const clearHideTimeout = useCallback((columnKey: string) => {
        const timeoutId = hideTimeoutsRef.current.get(columnKey)
        if (timeoutId !== undefined && typeof window !== "undefined") {
            window.clearTimeout(timeoutId)
        }
        hideTimeoutsRef.current.delete(columnKey)
    }, [])

    const descendantMapRef = useRef<Map<string, string[]>>(descendantColumnMap ?? new Map())

    useEffect(() => {
        descendantMapRef.current = descendantColumnMap ?? new Map()
    }, [descendantColumnMap])

    const emitVisibilityChanges = useCallback(
        (changes: {columnKey: string; visible: boolean}[]) => {
            if (!scopeId || !changes.length) return
            const deduped = new Map<string, boolean>()

            const queueChange = (columnKey: string, visible: boolean) => {
                const previous = visibilityStateRef.current.get(columnKey)
                if (previous === visible) {
                    return
                }
                deduped.set(columnKey, visible)
            }

            const propagate = (columnKey: string, visible: boolean) => {
                queueChange(columnKey, visible)
                const descendants = descendantMapRef.current.get(columnKey) ?? []
                descendants.forEach((childKey) => {
                    if (!childKey) return
                    propagate(childKey, visible)
                })
            }

            changes.forEach(({columnKey, visible}) => {
                propagate(columnKey, visible)
            })
            const expandedChanges = Array.from(deduped.entries()).map(([columnKey, visible]) => ({
                columnKey,
                visible,
            }))
            expandedChanges.forEach(({columnKey, visible}) => {
                visibilityStateRef.current.set(columnKey, visible)
            })
            const payload = expandedChanges.map(
                ({columnKey, visible}): ColumnViewportVisibilityEvent => ({
                    scopeId,
                    columnKey,
                    visible,
                }),
            )
            if (!payload.length) {
                return
            }
            if (payload.length === 1) {
                onVisibilityChange?.(payload[0])
                return
            }
            onVisibilityChange?.(payload)
        },
        [onVisibilityChange, scopeId],
    )

    const flushQueuedUpdates = useCallback(() => {
        rafRef.current = null
        const updates = queuedUpdatesRef.current
        queuedUpdatesRef.current = null
        if (!updates || updates.size === 0) return
        const changes = Array.from(updates.entries()).map(([columnKey, visible]) => ({
            columnKey,
            visible,
        }))
        emitVisibilityChanges(changes)
    }, [emitVisibilityChanges])

    const enqueueVisibilityChange = useCallback(
        (columnKey: string, visible: boolean) => {
            const previous = visibilityStateRef.current.get(columnKey)
            if (previous === visible) {
                return
            }
            let queue = queuedUpdatesRef.current
            if (!queue) {
                queue = new Map<string, boolean>()
                queuedUpdatesRef.current = queue
            }
            queue.set(columnKey, visible)
            if (rafRef.current === null && typeof window !== "undefined") {
                rafRef.current = window.requestAnimationFrame(flushQueuedUpdates)
            }
        },
        [flushQueuedUpdates],
    )

    const queueVisibilityUpdate = useCallback(
        (columnKey: string, visible: boolean) => {
            if (visible) {
                clearHideTimeout(columnKey)
                enqueueVisibilityChange(columnKey, true)
                return
            }
            const debounce = exitDebounceMs ?? 0
            if (debounce > 0 && typeof window !== "undefined") {
                if (hideTimeoutsRef.current.has(columnKey)) {
                    return
                }
                const timeoutId = window.setTimeout(() => {
                    hideTimeoutsRef.current.delete(columnKey)
                    enqueueVisibilityChange(columnKey, false)
                }, debounce)
                hideTimeoutsRef.current.set(columnKey, timeoutId)
                return
            }
            enqueueVisibilityChange(columnKey, false)
        },
        [clearHideTimeout, enqueueVisibilityChange, exitDebounceMs],
    )

    const handleEntries = useCallback(
        (entries: IntersectionObserverEntry[]) => {
            if (!onVisibilityChange || !scopeId) return
            entries.forEach((entry) => {
                const columnKey = elementToKeyRef.current.get(entry.target as HTMLElement)
                if (!columnKey) return
                const intersectionWidth = entry.intersectionRect?.width ?? 0
                const intersectionHeight = entry.intersectionRect?.height ?? 0
                const isVisible =
                    entry.isIntersecting &&
                    intersectionWidth > 0 &&
                    intersectionHeight > 0 &&
                    entry.boundingClientRect.width > 0
                queueVisibilityUpdate(columnKey, isVisible)
            })
        },
        [onVisibilityChange, queueVisibilityUpdate, scopeId],
    )

    const lastRootRef = useRef<Element | null>(null)
    const lastMarginRef = useRef<string | null>(null)

    const ensureObserver = useCallback(
        (enabled: boolean) => {
            if (!enabled || !onVisibilityChange || !scopeId) {
                return null
            }
            const currentRoot = containerRef.current
            // const nextMargin = viewportMargin ?? "200px 200px 200px 200px"
            const nextMargin = viewportMargin ?? "0px 0px 0px 0px"

            const createObserver = () => {
                if (typeof window === "undefined") {
                    return null
                }
                // console.log("createObserver", {currentRoot, nextMargin, intersectionThresholds})
                const observer = new IntersectionObserver(handleEntries, {
                    root: currentRoot,
                    rootMargin: nextMargin,
                    threshold: intersectionThresholds,
                })
                observerRef.current = observer
                lastRootRef.current = currentRoot ?? null
                lastMarginRef.current = nextMargin
                keyToElementRef.current.forEach((element) => observer.observe(element))
                return observer
            }

            if (observerRef.current) {
                const marginChanged = lastMarginRef.current !== nextMargin
                const rootChanged = lastRootRef.current !== currentRoot
                if (!marginChanged && !rootChanged) {
                    return observerRef.current
                }
                observerRef.current.disconnect()
                observerRef.current = null
            }

            return createObserver()
        },
        [containerRef, handleEntries, onVisibilityChange, scopeId, viewportMargin],
    )

    useEffect(() => {
        if (!enabled || !onVisibilityChange || !scopeId) {
            if (observerRef.current) {
                observerRef.current.disconnect()
                observerRef.current = null
            }
            keyToElementRef.current.clear()
            elementToKeyRef.current.clear()
            visibilityStateRef.current.clear()
            queuedUpdatesRef.current = null
            if (typeof window !== "undefined") {
                hideTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
            }
            hideTimeoutsRef.current.clear()
            if (rafRef.current !== null && typeof window !== "undefined") {
                window.cancelAnimationFrame(rafRef.current)
                rafRef.current = null
            }
            return
        }
        ensureObserver(enabled)
        return () => {
            if (observerRef.current) {
                observerRef.current.disconnect()
                observerRef.current = null
            }
            keyToElementRef.current.clear()
            elementToKeyRef.current.clear()
            visibilityStateRef.current.clear()
            queuedUpdatesRef.current = null
            if (typeof window !== "undefined") {
                hideTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
            }
            hideTimeoutsRef.current.clear()
            if (typeof window !== "undefined") {
                pendingUnregisterTimeoutsRef.current.forEach((timeoutId) =>
                    window.clearTimeout(timeoutId),
                )
            }
            pendingUnregisterTimeoutsRef.current.clear()
            if (rafRef.current !== null && typeof window !== "undefined") {
                window.cancelAnimationFrame(rafRef.current)
                rafRef.current = null
            }
        }
    }, [enabled, ensureObserver, onVisibilityChange, scopeId])

    const isFixedHeaderNode = useCallback((node: HTMLElement | null) => {
        if (!node) return false
        const thNode = node.closest("th")
        if (!thNode) return false
        return (
            thNode.classList.contains("ant-table-cell-fix-left") ||
            thNode.classList.contains("ant-table-cell-fix-right")
        )
    }, [])

    const registerHeader = useCallback(
        (columnKey: string) => {
            if (!enabled || !scopeId || !columnKey) {
                return () => undefined
            }
            return (node: HTMLElement | null) => {
                if (!enabled || !scopeId) return
                if (node) {
                    const pendingTimeout = pendingUnregisterTimeoutsRef.current.get(columnKey)
                    if (pendingTimeout !== undefined && typeof window !== "undefined") {
                        window.clearTimeout(pendingTimeout)
                        pendingUnregisterTimeoutsRef.current.delete(columnKey)
                    }
                    if (excludedKeySet.has(columnKey) || isFixedHeaderNode(node)) {
                        fixedKeysRef.current.add(columnKey)
                        keyToElementRef.current.delete(columnKey)
                        // emitVisibilityChanges([{columnKey, visible: true}])
                        return
                    }
                    const existingNode = keyToElementRef.current.get(columnKey)
                    if (existingNode === node) {
                        return
                    }
                    if (existingNode && observerRef.current) {
                        elementToKeyRef.current.delete(existingNode)
                        observerRef.current.unobserve(existingNode)
                    }
                    keyToElementRef.current.set(columnKey, node)
                    elementToKeyRef.current.set(node, columnKey)
                    const observer = ensureObserver(enabled)
                    // console.log("scopesWithChanges registerHeader", {
                    //     columnKey,
                    //     timestamp: Date.now(),
                    // })
                    observer?.observe(node)
                    if (typeof window !== "undefined") {
                        // console.log("computeImmediateVisibility", {columnKey, node})
                        // const visible = computeImmediateVisibility(
                        //     node,
                        //     containerRef.current,
                        //     viewportMargin,
                        // )
                        // emitVisibilityChanges([{columnKey, visible}])
                    }
                    return
                }
                const wasFixed = fixedKeysRef.current.delete(columnKey)
                if (wasFixed) {
                    // emitVisibilityChanges([{columnKey, visible: false}])
                    return
                }
                const previousNode = keyToElementRef.current.get(columnKey)
                if (previousNode && observerRef.current) {
                    observerRef.current.unobserve(previousNode)
                    elementToKeyRef.current.delete(previousNode)
                }
                keyToElementRef.current.delete(columnKey)
                const scheduleHide = () => {
                    visibilityStateRef.current.delete(columnKey)
                    emitVisibilityChanges([{columnKey, visible: false}])
                }
                if (typeof window !== "undefined") {
                    if (!pendingUnregisterTimeoutsRef.current.has(columnKey)) {
                        const timeoutId = window.setTimeout(() => {
                            pendingUnregisterTimeoutsRef.current.delete(columnKey)
                            scheduleHide()
                        }, exitDebounceMs ?? 150)
                        pendingUnregisterTimeoutsRef.current.set(columnKey, timeoutId)
                    }
                } else {
                    scheduleHide()
                }
            }
        },
        [
            emitVisibilityChanges,
            enabled,
            ensureObserver,
            excludedKeySet,
            exitDebounceMs,
            isFixedHeaderNode,
            onVisibilityChange,
            scopeId,
        ],
    )

    if (!enabled || !scopeId) {
        return undefined
    }

    return registerHeader
}

export default useHeaderViewportVisibility
