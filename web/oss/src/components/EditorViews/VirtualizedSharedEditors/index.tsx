// VirtualizedSharedEditors.tsx
import React, {memo, useCallback, useLayoutEffect, useRef, useState, useEffect} from "react"
import {VariableSizeList as List} from "react-window"
import {useResizeObserver} from "usehooks-ts"

type Entry = {k: string; v: unknown}

type Props = {
    entries: Entry[]
    overscanCount?: number
    estimatedRowHeight?: number
    className?: string
    renderRow: (entry: Entry) => React.ReactNode
    /** Max viewport height you'd like to use; list will shrink if content is shorter */
    listHeight?: number
}

const VirtualizedSharedEditors: React.FC<Props> = memo(
    ({
        entries,
        overscanCount = 2,
        estimatedRowHeight = 120,
        className,
        renderRow,
        listHeight = 500,
    }) => {
        const sizeMap = useRef(new Map<number, number>())
        const measuredTotalRef = useRef(0) // sum of measured rows
        const measuredCountRef = useRef(0) // how many rows are measured
        const listRef = useRef<List>(null)

        const getItemSize = useCallback(
            (index: number) => sizeMap.current.get(index) ?? estimatedRowHeight,
            [estimatedRowHeight],
        )

        const setItemSize = useCallback((index: number, size: number) => {
            const prev = sizeMap.current.get(index)
            if (prev === undefined) {
                measuredCountRef.current += 1
                measuredTotalRef.current += size
            } else if (prev !== size) {
                measuredTotalRef.current += size - prev
            }
            if (prev !== size) {
                sizeMap.current.set(index, size)
                listRef.current?.resetAfterIndex(index)
            }
        }, [])

        // container width (and optional height if parent gives one)
        const containerRef = useRef<HTMLDivElement | null>(null)
        const [containerSize, setContainerSize] = useState({width: 0, height: 0})
        useResizeObserver({
            ref: containerRef,
            onResize: (entry) => {
                const {width, height} = entry.contentRect || {}
                setContainerSize({width, height})
            },
            box: "content-box",
        })

        useLayoutEffect(() => {
            listRef.current?.resetAfterIndex(0, true)
        }, [containerSize.width, containerSize.height])

        // reset caches if data length changes a lot
        useEffect(() => {
            sizeMap.current.clear()
            measuredTotalRef.current = 0
            measuredCountRef.current = 0
            listRef.current?.resetAfterIndex(0, true)
        }, [entries])

        // callback-ref observer for each row (robust inside react-window)
        const observersRef = useRef<Map<number, ResizeObserver>>(new Map())
        const attachMeasuredRef = useCallback(
            (index: number) => (el: HTMLDivElement | null) => {
                const prev = observersRef.current.get(index)
                if (prev) {
                    prev.disconnect()
                    observersRef.current.delete(index)
                }
                if (!el) return

                const measure = () => {
                    const h = Math.max(0, Math.ceil(el.getBoundingClientRect().height)) + 1
                    setItemSize(index, h)
                }
                measure()

                const ro = new ResizeObserver(measure)
                ro.observe(el)
                observersRef.current.set(index, ro)
            },
            [setItemSize],
        )
        useEffect(
            () => () => {
                observersRef.current.forEach((ro) => ro.disconnect())
                observersRef.current.clear()
            },
            [],
        )

        const Row = useCallback(
            ({index, style}: {index: number; style: React.CSSProperties}) => (
                <div style={{...style, overflow: "hidden"}}>
                    <div ref={attachMeasuredRef(index)} className="px-0 py-1">
                        {renderRow(entries[index])}
                    </div>
                </div>
            ),
            [entries, renderRow, attachMeasuredRef],
        )

        // ----- “max-height” behavior -----
        // Approx total content height = measured + estimate for unmeasured
        const approxTotalHeight =
            measuredTotalRef.current +
            (entries.length - measuredCountRef.current) * estimatedRowHeight

        // viewport cap (never 0 to ensure rendering on first paint)
        const viewportCap = Math.max(200, Number.isFinite(listHeight) ? (listHeight as number) : 0)

        // If content fits under the cap, skip virtualization: render plain stack that auto-sizes.
        const fitsWithoutScroll = approxTotalHeight <= viewportCap + 1

        if (fitsWithoutScroll) {
            return (
                <div ref={containerRef} className={className}>
                    {entries.map((e, i) => (
                        <div key={e.k ?? i} className="px-0 py-1">
                            {renderRow(e)}
                        </div>
                    ))}
                </div>
            )
        }

        // Otherwise, virtualize with a fixed viewport height (the “max”)
        return (
            <div ref={containerRef} className={className} style={{height: "100%"}}>
                <List
                    ref={listRef}
                    height={viewportCap}
                    width={containerSize.width || "100%"}
                    itemCount={entries.length}
                    itemSize={getItemSize}
                    estimatedItemSize={estimatedRowHeight}
                    overscanCount={overscanCount}
                    itemKey={(i) => entries[i]?.k ?? i}
                >
                    {Row as any}
                </List>
            </div>
        )
    },
)

export default VirtualizedSharedEditors
