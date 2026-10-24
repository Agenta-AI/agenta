/** The slice of a hast table the chat's table chrome reads. */
export interface HastNode {
    type: string
    tagName?: string
    value?: string
    children?: HastNode[]
    properties?: {href?: unknown}
    position?: {start?: {line?: number; column?: number}}
}

export interface ColumnLayout {
    /** Every non-empty body cell reads as a number: right-aligned, tabular, never wrapped. */
    numeric: boolean
    /** Some cell is long enough to be a sentence: the column wraps. */
    prose: boolean
}

export interface TableModel {
    header: string[]
    /** Body rows, each padded or cut to the header's width. */
    rows: string[][]
    columns: ColumnLayout[]
    /** Header and rows again as Markdown, so a copy keeps link destinations. */
    markdown: {header: string[]; rows: string[][]}
}

export interface CellLayout extends ColumnLayout {
    first: boolean
}

const PROSE_MIN_CHARS = 40

const EMPTY_CELLS = new Set(["", "—", "–", "-"])

const NUMBER = String.raw`[-+]?[$€£¥]?(?:\d[\d,]*(?:\.\d+)?|\.\d+)`
const UNIT = String.raw`(?:\s?(?:%|×|[a-zA-Zµ]{1,4}))?`
// `~2–4s`, `$0.111`, `10.3%`, `1,204`, `4–9 min`, `$1.20 / hr`.
const NUMERIC_CELL = new RegExp(
    String.raw`^[~≈<>≤≥±]?\s?${NUMBER}${UNIT}(?:\s?[–—-]\s?${NUMBER}${UNIT})?(?:\s?\/\s?[a-zA-Z]{1,4})?$`,
)

export const isNumericCell = (text: string): boolean => NUMERIC_CELL.test(text.trim())

const isEmptyCell = (text: string): boolean => EMPTY_CELLS.has(text.trim())

const textOf = (node: HastNode): string =>
    node.type === "text" ? (node.value ?? "") : (node.children ?? []).map(textOf).join("")

/** Cell text with each link written as Markdown; a bare URL stays bare. */
const markdownOf = (node: HastNode): string => {
    if (node.type === "text") return node.value ?? ""
    const inner = (node.children ?? []).map(markdownOf).join("")
    const href = node.tagName === "a" ? node.properties?.href : undefined
    if (typeof href !== "string" || !href || inner === href) return inner
    // Percent-encode what would end or break a CommonMark destination.
    const destination = href.replace(
        /[\s()<>]/g,
        (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
    )
    return `[${inner}](${destination})`
}

const elements = (node: HastNode, tag: string): HastNode[] =>
    (node.children ?? []).filter((child) => child.type === "element" && child.tagName === tag)

const isCell = (node: HastNode) =>
    node.type === "element" && (node.tagName === "th" || node.tagName === "td")

/** Every row of the table, header rows first, as its cell elements. */
const rowsOf = (table: HastNode): HastNode[][] => {
    const sections = (table.children ?? []).filter(
        (child) =>
            child.type === "element" && (child.tagName === "thead" || child.tagName === "tbody"),
    )
    const trs = sections.length
        ? sections.flatMap((section) => elements(section, "tr"))
        : elements(table, "tr")
    return trs.map((tr) => (tr.children ?? []).filter(isCell))
}

const fit = (cells: string[], width: number): string[] =>
    Array.from({length: width}, (_, i) => cells[i] ?? "")

export const tableModel = (node: HastNode): TableModel => {
    const cellRows = rowsOf(node)
    const [headRow = [], ...bodyRows] = cellRows.map((cells) =>
        cells.map((cell) => textOf(cell).trim()),
    )
    const [markdownHead = [], ...markdownBody] = cellRows.map((cells) =>
        cells.map((cell) => markdownOf(cell).trim()),
    )
    const header = headRow
    const rows = bodyRows.map((cells) => fit(cells, header.length))
    const columns = header.map((_, col): ColumnLayout => {
        const filled = rows.map((row) => row[col]).filter((text) => !isEmptyCell(text))
        const numbers = filled.filter(isNumericCell).length
        return {
            // Mostly numbers, not all: a stray label row (a repeated header) must not flip the column.
            numeric: numbers > 0 && numbers * 3 >= filled.length * 2,
            prose: rows.some((row) => row[col].length > PROSE_MIN_CHARS),
        }
    })
    return {
        header,
        rows,
        columns,
        markdown: {
            header: markdownHead,
            rows: markdownBody.map((cells) => fit(cells, header.length)),
        },
    }
}

/** Cells are matched back to their column by source position: a cell renderer has no index. */
export const cellKey = (position: HastNode["position"]): string | null => {
    const start = position?.start
    return start?.line != null && start.column != null ? `${start.line}:${start.column}` : null
}

export const cellLayouts = (node: HastNode, model: TableModel): Map<string, CellLayout> => {
    const out = new Map<string, CellLayout>()
    for (const cells of rowsOf(node)) {
        cells.forEach((cell, col) => {
            const key = cellKey(cell.position)
            const column = model.columns[col]
            if (key && column) out.set(key, {...column, first: col === 0})
        })
    }
    return out
}

const markdownCell = (text: string) =>
    text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ")

export const toMarkdown = (model: TableModel): string => {
    const line = (cells: string[]) => `| ${cells.map(markdownCell).join(" | ")} |`
    const rule = `| ${model.columns.map((column) => (column.numeric ? "---:" : "---")).join(" | ")} |`
    return [line(model.markdown.header), rule, ...model.markdown.rows.map(line)].join("\n")
}

// A spreadsheet runs a cell that starts with = + - @ (or their full-width forms) as a formula;
// a plain number is left alone.
const defuse = (text: string) =>
    /^[=+\-@\t\r＝＋－＠]/.test(text) && !/^[-+]?[\d.,]*%?$/.test(text) ? `'${text}` : text

const csvField = (raw: string) => {
    const text = defuse(raw)
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** RFC 4180: CRLF rows, a field with a comma, quote or line break quoted, quotes doubled. */
export const toCsv = (model: TableModel): string =>
    [model.header, ...model.rows].map((cells) => cells.map(csvField).join(",")).join("\r\n")
