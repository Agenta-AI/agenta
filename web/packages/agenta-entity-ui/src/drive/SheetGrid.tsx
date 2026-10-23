import {useState, type MouseEvent, type ReactNode} from "react"

import {columnName, encodeCell, type CellOrigin} from "./cellAddress"
import {isInBox, type CellSelection} from "./spreadsheetComments"
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
            {cell ? (cell.formula ?? ("value" in cell ? cell.value : "")) : ""}
        </div>
    </div>
)

const HEADER = "bg-colorFillQuaternary font-normal text-colorTextTertiary"
const LINE = "border-0 border-b border-r border-solid border-colorBorderSecondary"

/** A sheet as a spreadsheet grid: column letters, row numbers, gridlines and a formula bar. */
export function SheetGrid({
    rows,
    origin,
    comments,
}: {
    rows: SheetCell[][]
    origin: CellOrigin
    /** Comment mode: cells select a range by pointer instead of one cell by click. */
    comments?: CellSelection
}) {
    const [picked, setPicked] = useState<{r: number; c: number} | null>(null)
    const active = comments ? comments.box && {r: comments.box.top, c: comments.box.left} : picked
    const width = rows[0]?.length ?? 0
    const columns = range(Math.max(width, MIN_COLUMNS))
    const lines = range(Math.max(rows.length, MIN_ROWS))
    const selected = (r: number, c: number) =>
        comments ? !!comments.box && isInBox(comments.box, r, c) : picked?.r === r && picked.c === c
    const hover = comments
        ? "hover:outline hover:outline-2 hover:-outline-offset-2 hover:outline-colorPrimary"
        : ""
    const onClick = (e: MouseEvent) => {
        const cell =
            e.target instanceof Element ? e.target.closest<HTMLElement>("[data-row]") : null
        if (cell) setPicked({r: Number(cell.dataset.row), c: Number(cell.dataset.col)})
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <FormulaBar
                address={active ? encodeCell(origin.r + active.r, origin.c + active.c) : ""}
                cell={active ? rows[active.r]?.[active.c] : undefined}
            />
            <div className="min-h-0 flex-1 overflow-auto bg-colorBgContainer">
                <table
                    className={`min-w-full border-separate border-spacing-0 text-[13px] ${comments ? "cursor-cell select-none" : ""}`}
                    onPointerDown={comments?.onPointerDown}
                    onPointerOver={comments?.onPointerOver}
                    onClick={comments ? undefined : onClick}
                >
                    <thead>
                        <tr>
                            <th
                                className={`sticky left-0 top-0 z-20 w-12 min-w-12 ${LINE} ${HEADER}`}
                            />
                            {columns.map((c) => (
                                <th
                                    key={c}
                                    className={`sticky top-0 z-10 h-7 min-w-24 px-2 text-center ${LINE} ${HEADER} ${active?.c === c ? "!bg-colorFillSecondary !text-colorText" : ""}`}
                                >
                                    {columnName(origin.c + c)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {lines.map((r) => (
                            <tr key={r}>
                                <th
                                    className={`sticky left-0 z-10 h-7 px-2 text-center tabular-nums ${LINE} ${HEADER} ${active?.r === r ? "!bg-colorFillSecondary !text-colorText" : ""}`}
                                >
                                    {origin.r + r + 1}
                                </th>
                                {columns.map((c) => {
                                    const cell =
                                        r < rows.length && c < width ? rows[r][c] : undefined
                                    if (!cell) return <td key={c} className={LINE} />
                                    const numeric = "value" in cell && cell.numeric
                                    return (
                                        <td
                                            key={c}
                                            data-row={r}
                                            data-col={c}
                                            className={`max-w-80 overflow-hidden text-ellipsis whitespace-pre px-2 py-1 align-top ${numeric ? "text-right tabular-nums" : ""} ${LINE} ${hover} ${selected(r, c) ? (comments ? "bg-colorInfoBg" : "outline outline-2 -outline-offset-2 outline-colorPrimary") : ""}`}
                                        >
                                            <PreviewCell cell={cell} />
                                        </td>
                                    )
                                })}
                            </tr>
                        ))}
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
    const columns = sheet.rows[0]?.length ?? 0
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
