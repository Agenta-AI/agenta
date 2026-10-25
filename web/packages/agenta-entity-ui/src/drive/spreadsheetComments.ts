// Comment mode for the spreadsheet preview (design D7, D9): cell selection, the pick, and pins.
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
    type RefObject,
} from "react"

import {cellsToTable, type PreviewQuote} from "@agenta/shared/quotes"
import type {PreviewPick, PreviewPinRect, PreviewRect} from "@agenta/ui/quote-selection"

import {boxToRange, rangeToBox, tableWidth, type CellBox} from "./cellAddress"
import type {Sheet, SheetCell, Workbook} from "./workbook"

/** What `SheetGrid` needs in comment mode. */
export interface CellSelection {
    box: CellBox | null
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
    onPointerOver: (e: ReactPointerEvent<HTMLElement>) => void
    /** A note is open: the grid shows no hover until it closes. */
    held?: boolean
}

interface CellPoint {
    r: number
    c: number
}

const cellText = (cell: SheetCell): string => ("value" in cell ? cell.value : cell.formula)

/** The selected cells as a pipe table, under the sheet's first row when the box starts below it. */
export function boxText(rows: SheetCell[][], box: CellBox): string {
    const columns = (row: SheetCell[]) => row.slice(box.left, box.right + 1).map(cellText)
    const body = rows.slice(box.top, box.bottom + 1).map(columns)
    return cellsToTable(box.top > 0 ? columns(rows[0]) : null, body)
}

const boxOf = (a: CellPoint, b: CellPoint): CellBox => ({
    top: Math.min(a.r, b.r),
    left: Math.min(a.c, b.c),
    bottom: Math.max(a.r, b.r),
    right: Math.max(a.c, b.c),
})

const pointOf = (target: EventTarget): CellPoint | null => {
    const cell = target instanceof Element ? target.closest<HTMLElement>("[data-row]") : null
    if (!cell) return null
    return {r: Number(cell.dataset.row), c: Number(cell.dataset.col)}
}

/** The cell at `Sheet.rows[r][c]`; the grid's letter row and number column are not cells. */
const cellRect = (root: HTMLElement, r: number, c: number): DOMRect | null =>
    root.querySelector(`[data-row="${r}"][data-col="${c}"]`)?.getBoundingClientRect() ?? null

function boxRect(root: HTMLElement, box: CellBox): PreviewRect | null {
    const start = cellRect(root, box.top, box.left)
    const end = cellRect(root, box.bottom, box.right)
    if (!start || !end) return null
    const origin = root.getBoundingClientRect()
    const top = Math.min(start.top, end.top)
    const left = Math.min(start.left, end.left)
    return {
        top: top - origin.top,
        left: left - origin.left,
        width: Math.max(start.right, end.right) - left,
        height: Math.max(start.bottom, end.bottom) - top,
    }
}

/** Where each comment on this workbook's cells sits now; null when its cells changed or are gone. */
function measurePins(
    root: HTMLElement,
    workbook: Workbook,
    sheet: Sheet,
    comments: PreviewQuote[],
): PreviewPinRect[] {
    const width = tableWidth(sheet.rows)
    return comments.flatMap((quote): PreviewPinRect[] => {
        const anchor = quote.source.anchor
        if (anchor.type !== "cells") return []
        // A CSV is one unnamed sheet; its anchors carry no sheet.
        const sheetName = anchor.sheet ?? ""
        if (sheetName !== sheet.name) {
            const exists = workbook.sheets.some((s) => s.name === sheetName)
            return exists ? [] : [{id: quote.id, rect: null}]
        }
        const box = rangeToBox(sheet.origin, anchor.range)
        const fits = box && box.bottom < sheet.rows.length && box.right < width
        if (!fits || boxText(sheet.rows, box) !== quote.text) return [{id: quote.id, rect: null}]
        return [{id: quote.id, rect: boxRect(root, {...box, bottom: box.top, right: box.left})}]
    })
}

export function useSheetComments({
    rootRef,
    workbook,
    sheet,
    comments,
    enabled,
}: {
    rootRef: RefObject<HTMLElement | null>
    workbook: Workbook
    sheet: Sheet
    comments: PreviewQuote[]
    enabled: boolean
}) {
    const [box, setBox] = useState<CellBox | null>(null)
    const [dragging, setDragging] = useState(false)
    const [pick, setPick] = useState<PreviewPick | null>(null)
    const [pinRects, setPinRects] = useState<PreviewPinRect[]>([])
    const anchor = useRef<CellPoint | null>(null)
    const latest = useRef({box, sheet})
    latest.current = {box, sheet}

    useEffect(() => {
        anchor.current = null
        setBox(null)
        setDragging(false)
    }, [enabled, sheet])

    useEffect(() => {
        if (!dragging) return
        const up = () => {
            setDragging(false)
            const {box: picked, sheet: current} = latest.current
            const rect = picked && rootRef.current ? boxRect(rootRef.current, picked) : null
            if (!picked || !rect) return
            setPick({
                anchor: {
                    type: "cells",
                    ...(current.name ? {sheet: current.name} : {}),
                    range: boxToRange(current.origin, picked),
                },
                text: boxText(current.rows, picked),
                rect,
            })
        }
        const cancel = () => setDragging(false)
        window.addEventListener("pointerup", up)
        window.addEventListener("pointercancel", cancel)
        return () => {
            window.removeEventListener("pointerup", up)
            window.removeEventListener("pointercancel", cancel)
        }
    }, [dragging, rootRef])

    const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
        if (e.button !== 0) return
        const point = pointOf(e.target)
        if (!point) return
        // Keeps the browser from selecting text under the drag.
        e.preventDefault()
        if (!e.shiftKey || !anchor.current) anchor.current = point
        setBox(boxOf(anchor.current, point))
        setDragging(true)
    }, [])

    const onPointerOver = useCallback(
        (e: ReactPointerEvent<HTMLElement>) => {
            if (!dragging || !anchor.current) return
            const point = pointOf(e.target)
            if (point) setBox(boxOf(anchor.current, point))
        },
        [dragging],
    )

    useLayoutEffect(() => {
        const root = rootRef.current
        if (!root) return
        const measure = () => setPinRects(measurePins(root, workbook, sheet, comments))
        measure()
        let frame = 0
        const schedule = () => {
            if (!frame)
                frame = requestAnimationFrame(() => {
                    frame = 0
                    measure()
                })
        }
        root.addEventListener("scroll", schedule, true)
        const observer = new ResizeObserver(schedule)
        observer.observe(root)
        return () => {
            cancelAnimationFrame(frame)
            root.removeEventListener("scroll", schedule, true)
            observer.disconnect()
        }
    }, [rootRef, workbook, sheet, comments])

    const selection: CellSelection | undefined = enabled
        ? {box, onPointerDown, onPointerOver}
        : undefined
    // The anchor stays, so Shift+click still extends from the last cell.
    const onDraftClose = useCallback(() => setBox(null), [])
    return {selection, pick, onPickConsumed: () => setPick(null), onDraftClose, pinRects}
}
