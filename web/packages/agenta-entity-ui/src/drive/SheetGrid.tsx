import {memo, useState, type MouseEvent, type ReactNode} from "react"

import {columnName, encodeCell, tableWidth, type CellBox, type CellOrigin} from "./cellAddress"
import type {CellSelection} from "./spreadsheetComments"
import type {Sheet, SheetCell, Truncation} from "./workbook"

// Empty rows and columns past the data, so a small sheet still reads as a grid.
const MIN_ROWS = 30
const MIN_COLUMNS = 8

// One huge cell would otherwise widen its column past every other column.
const CELL_CHAR_CAP = 500
const capText = (text: string): string =>
    text.length > CELL_CHAR_CAP ? `${text.slice(0, CELL_CHAR_CAP)}…` : text

const range = (n: number) => Array.from({length: n}, (_, i) => i)

const PreviewCell = ({cell}: {cell: SheetCell}) =>
    "value" in cell ? (
        <>{capText(cell.value)}</>
    ) : (
        <span className="italic text-colorTextTertiary" title="Formula with no stored value">
            {capText(cell.formula)}
        </span>
    )

const FormulaBar = ({address, cell}: {address: string; cell: SheetCell | undefined}) => (
    <div className="flex h-8 shrink-0 items-stretch border-0 border-b border-solid border-colorBorderSecondary bg-colorBgContainer font-mono text-xs">
        <div className="flex w-20 shrink-0 items-center border-0 border-r border-solid border-colorBorderSecondary px-2">
            {address}
        </div>
        <div className="flex w-8 shrink-0 items-center justify-center border-0 border-r border-solid border-colorBorderSecondary font-serif italic text-colorTextTertiary">
            fx
        </div>
        <div className="flex min-w-0 flex-1 items-center truncate px-2">
            {!cell ? "" : "value" in cell ? (cell.formula ?? cell.raw ?? cell.value) : cell.formula}
        </div>
    </div>
)

// Sticky cells sit over scrolled rows, so each tint is painted over a solid container color.
const HEADER =
    "bg-colorBgContainer bg-[image:linear-gradient(var(--ag-colorFillTertiary),var(--ag-colorFillTertiary))] font-normal text-colorTextTertiary"
const LINE = "border-0 border-b border-r border-solid border-colorBorderSecondary"
const ACTIVE_HEADER =
    "!bg-[image:linear-gradient(var(--ag-colorFillSecondary),var(--ag-colorFillSecondary))] !text-colorText"

/** One grid row; memoized so a selection change redraws only the rows it touches. */
const GridRow = memo(function GridRow({
    cells,
    r,
    label,
    width,
    columnCount,
    commenting,
    hovering,
    selLeft,
    selRight,
    active,
    sticky,
}: {
    cells: SheetCell[] | undefined
    r: number
    label: number
    width: number
    columnCount: number
    commenting: boolean
    hovering: boolean
    /** The selected columns in this row, inclusive; -1 when none. */
    selLeft: number
    selRight: number
    active: boolean
    sticky: boolean
}) {
    // Under the letter row, which is h-7 tall.
    const pin = sticky ? "sticky top-7 bg-colorBgContainer" : ""
    const hover = hovering
        ? "hover:bg-colorSelectionBg hover:outline hover:outline-2 hover:-outline-offset-2 hover:outline-colorSelection"
        : ""
    const picked = commenting
        ? "bg-colorSelectionBg"
        : "outline outline-2 -outline-offset-2 outline-colorSelection"
    return (
        <tr>
            <th
                className={`sticky left-0 h-7 px-2 text-center tabular-nums ${sticky ? "top-7 z-20" : "z-10"} ${LINE} ${HEADER} ${active ? ACTIVE_HEADER : ""}`}
            >
                {label}
            </th>
            {range(columnCount).map((c) => {
                const cell = cells && c < width ? cells[c] : undefined
                if (!cell) return <td key={c} className={`${LINE} ${pin}`} />
                const numeric = "value" in cell && cell.numeric
                return (
                    <td
                        key={c}
                        data-row={r}
                        data-col={c}
                        className={`max-w-80 overflow-hidden text-ellipsis whitespace-pre px-2 py-1 align-top ${numeric ? "text-right tabular-nums" : ""} ${LINE} ${pin} ${sticky ? "z-[5]" : ""} ${hover} ${c >= selLeft && c <= selRight ? picked : ""}`}
                    >
                        <PreviewCell cell={cell} />
                    </td>
                )
            })}
        </tr>
    )
})

/** A sheet as a spreadsheet grid: column letters, row numbers, gridlines and a formula bar. */
export function SheetGrid({
    rows,
    origin,
    comments,
    stickyFirstRow = false,
}: {
    rows: SheetCell[][]
    origin: CellOrigin
    /** Comment mode: cells select a range by pointer instead of one cell by click. */
    comments?: CellSelection
    /** Keeps row 1 in view while scrolling, for files whose first row names the columns. */
    stickyFirstRow?: boolean
}) {
    // Tied to the rows it was picked on, so a refreshed file starts with no selection.
    const [picked, setPicked] = useState<{rows: SheetCell[][]; box: CellBox} | null>(null)
    const box = comments ? comments.box : picked?.rows === rows ? picked.box : null
    const width = tableWidth(rows)
    const columnCount = Math.max(width, MIN_COLUMNS)
    const onClick = (e: MouseEvent) => {
        const cell =
            e.target instanceof Element ? e.target.closest<HTMLElement>("[data-row]") : null
        if (!cell) return
        const r = Number(cell.dataset.row)
        const c = Number(cell.dataset.col)
        setPicked({rows, box: {top: r, left: c, bottom: r, right: c}})
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <FormulaBar
                address={box ? encodeCell(origin.r + box.top, origin.c + box.left) : ""}
                cell={box ? rows[box.top]?.[box.left] : undefined}
            />
            <div className="min-h-0 flex-1 overflow-auto bg-colorBgContainer">
                <table
                    className={`min-w-full border-separate border-spacing-0 text-[13px] ${comments ? "select-none" : ""} ${comments && !comments.held ? "cursor-cell" : ""}`}
                    onPointerDown={comments?.onPointerDown}
                    onPointerOver={comments?.onPointerOver}
                    onClick={comments ? undefined : onClick}
                >
                    <thead>
                        <tr>
                            <th
                                className={`sticky left-0 top-0 z-30 w-12 min-w-12 ${LINE} ${HEADER}`}
                            />
                            {range(columnCount).map((c) => (
                                <th
                                    key={c}
                                    className={`sticky top-0 z-20 h-7 min-w-24 px-2 text-center ${LINE} ${HEADER} ${box && c >= box.left && c <= box.right ? ACTIVE_HEADER : ""}`}
                                >
                                    {columnName(origin.c + c)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {range(Math.max(rows.length, MIN_ROWS)).map((r) => {
                            const inBox = !!box && r >= box.top && r <= box.bottom
                            return (
                                <GridRow
                                    key={r}
                                    cells={rows[r]}
                                    r={r}
                                    label={origin.r + r + 1}
                                    width={width}
                                    columnCount={columnCount}
                                    commenting={!!comments}
                                    hovering={!!comments && !comments.held}
                                    selLeft={inBox ? box.left : -1}
                                    selRight={inBox ? box.right : -1}
                                    active={inBox}
                                    sticky={stickyFirstRow && r === 0}
                                />
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

function truncationNote(truncated: Truncation, shownRows: number, shownColumns: number) {
    const parts = [
        truncated.rows ? `the first ${shownRows} rows` : null,
        truncated.totalColumns !== null
            ? `${shownColumns} of ${truncated.totalColumns} columns`
            : null,
    ].filter(Boolean)
    return parts.length ? `Showing ${parts.join(" and ")}; download for the full file.` : null
}

/** The bar under a sheet: its tabs, if any, and its size or what the caps cut. */
export function SheetFooter({sheet, children}: {sheet: Sheet; children?: ReactNode}) {
    const columns = tableWidth(sheet.rows)
    const note = truncationNote(sheet.truncated, sheet.rows.length, columns)
    return (
        <div className="flex shrink-0 items-center gap-3 border-0 border-t border-solid border-colorBorderSecondary bg-colorFillQuaternary pr-3">
            <div className="min-w-0 flex-1">{children}</div>
            <span className="shrink-0 text-xs text-colorTextTertiary">
                {note ?? `${sheet.rows.length} rows · ${columns} columns`}
            </span>
        </div>
    )
}
