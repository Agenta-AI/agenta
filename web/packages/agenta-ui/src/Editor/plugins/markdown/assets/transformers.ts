import {
    CHECK_LIST,
    CODE,
    ELEMENT_TRANSFORMERS,
    MULTILINE_ELEMENT_TRANSFORMERS,
    TEXT_FORMAT_TRANSFORMERS,
    TEXT_MATCH_TRANSFORMERS,
    Transformer,
    ElementTransformer,
    $convertFromMarkdownString,
} from "@lexical/markdown"
import {$convertToMarkdownString as originalConvert} from "@lexical/markdown"
import {
    $createHorizontalRuleNode,
    $isHorizontalRuleNode,
    HorizontalRuleNode,
} from "@lexical/react/LexicalHorizontalRuleNode"
import {
    $createTableCellNode,
    $createTableNode,
    $createTableRowNode,
    $isTableCellNode,
    $isTableNode,
    $isTableRowNode,
    TableCellHeaderStates,
    TableCellNode,
    TableNode,
    TableRowNode,
} from "@lexical/table"
import {$dfs} from "@lexical/utils"
import {
    $isParagraphNode,
    $isTextNode,
    createEditor,
    ElementNode,
    LexicalEditor,
    LexicalNode,
} from "lexical"

import {findBackslashEscapes, unescapeTemplateDelimiters} from "../utils/textCleanup"

// Stores the original markdown divider patterns (e.g. ":---", "---:", ":---:")
// keyed by table node key so we can reproduce them exactly on export.
// Uses node key (string) instead of node identity because Lexical clones nodes on mutation.
const tableDividerMap = new Map<string, string[]>()

export function $convertToMarkdownStringCustom(
    transformers: Transformer[],
    node?: ElementNode,
    shouldPreserveNewLines?: boolean,
): string {
    return unescapeTemplateDelimiters(originalConvert(transformers, node, shouldPreserveNewLines))
}

export const HR: ElementTransformer = {
    dependencies: [HorizontalRuleNode],
    export: (node: LexicalNode) => {
        return $isHorizontalRuleNode(node) ? "***" : null
    },
    regExp: /^(---|\*\*\*|___)\s?$/,
    replace: (parentNode, _1, _2, isImport) => {
        const line = $createHorizontalRuleNode()

        // TODO: Get rid of isImport flag
        if (isImport || parentNode.getNextSibling() != null) {
            parentNode.replace(line)
        } else {
            parentNode.insertBefore(line)
        }

        // Only a typed rule moves the caret; an import must leave the selection alone.
        if (!isImport) line.selectNext()
    },
    type: "element",
}

// Very primitive table setup
const TABLE_ROW_REG_EXP = /^(?:\|)(.+)(?:\|)\s?$/
const TABLE_ROW_DIVIDER_REG_EXP = /^(?:\| ?:?-+:? ?)+\|\s?$/
export const TABLE: ElementTransformer = {
    dependencies: [TableNode, TableRowNode, TableCellNode],
    export: (node: LexicalNode) => {
        if (!$isTableNode(node)) {
            return null
        }

        const output: string[] = []

        for (const row of node.getChildren()) {
            const rowOutput = []
            if (!$isTableRowNode(row)) {
                continue
            }

            let isHeaderRow = false
            for (const cell of row.getChildren()) {
                // It's TableCellNode so it's just to make flow happy
                if ($isTableCellNode(cell)) {
                    rowOutput.push(
                        $convertToMarkdownStringCustom(PLAYGROUND_TRANSFORMERS, cell)
                            .replace(/\n/g, "\\n")
                            .replace(/\|/g, "\\|")
                            .trim(),
                    )
                    if (cell.__headerState === TableCellHeaderStates.ROW) {
                        isHeaderRow = true
                    }
                }
            }

            output.push(`| ${rowOutput.join(" | ")} |`)
            if (isHeaderRow) {
                const storedDividers = tableDividerMap.get(node.getKey())
                output.push(
                    `| ${rowOutput.map((_, i) => storedDividers?.[i] ?? "---").join(" | ")} |`,
                )
            }
        }

        return output.join("\n")
    },
    regExp: TABLE_ROW_REG_EXP,
    replace: (parentNode, _1, match, isImport) => {
        // Header row
        if (TABLE_ROW_DIVIDER_REG_EXP.test(match[0])) {
            const table = parentNode.getPreviousSibling()
            if (!table || !$isTableNode(table)) {
                return
            }

            // Preserve the original divider patterns (e.g. ":---", "---:", ":---:")
            const dividerCells = match[0]
                .trim()
                .replace(/^\||\|$/g, "")
                .split("|")
                .map((s) => s.trim())
            tableDividerMap.set(table.getKey(), dividerCells)

            const rows = table.getChildren()
            const lastRow = rows[rows.length - 1]
            if (!lastRow || !$isTableRowNode(lastRow)) {
                return
            }

            // Add header state to row cells
            lastRow.getChildren().forEach((cell) => {
                if (!$isTableCellNode(cell)) {
                    return
                }
                cell.setHeaderStyles(TableCellHeaderStates.ROW, TableCellHeaderStates.ROW)
            })

            // Remove line
            parentNode.remove()
            return
        }

        const matchCells = mapToTableCells(match[0])

        if (matchCells == null) {
            return
        }

        const rows = [matchCells]
        let sibling = parentNode.getPreviousSibling()
        let maxCells = matchCells.length

        while (sibling) {
            if (!$isParagraphNode(sibling)) {
                break
            }

            if (sibling.getChildrenSize() !== 1) {
                break
            }

            const firstChild = sibling.getFirstChild()

            if (!$isTextNode(firstChild)) {
                break
            }

            const cells = mapToTableCells(firstChild.getTextContent())

            if (cells == null) {
                break
            }

            maxCells = Math.max(maxCells, cells.length)
            rows.unshift(cells)
            const previousSibling = sibling.getPreviousSibling()
            sibling.remove()
            sibling = previousSibling
        }

        const table = $createTableNode()

        for (const cells of rows) {
            const tableRow = $createTableRowNode()
            table.append(tableRow)

            for (let i = 0; i < maxCells; i++) {
                tableRow.append(i < cells.length ? cells[i] : $createTableCell(""))
            }
        }

        const previousSibling = parentNode.getPreviousSibling()
        if ($isTableNode(previousSibling) && getTableColumnsSize(previousSibling) === maxCells) {
            previousSibling.append(...table.getChildren())
            parentNode.remove()
        } else {
            parentNode.replace(table)
        }

        if (!isImport) table.selectEnd()
    },
    type: "element",
}

function getTableColumnsSize(table: TableNode) {
    const row = table.getFirstChild()
    return $isTableRowNode(row) ? row.getChildrenSize() : 0
}

// "\n" and "|" count only when an even number of backslashes comes before them, so a cell
// can hold a literal "\n" (saved as "\\n") or a pipe (saved as "\|").
const $createTableCell = (textContent: string): TableCellNode => {
    textContent = textContent.replace(/(?<=(?<!\\)(?:\\\\)*)\\n/g, "\n")
    const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS)
    $convertFromMarkdownString(textContent, PLAYGROUND_TRANSFORMERS, cell)
    return cell
}

const mapToTableCells = (textContent: string): TableCellNode[] | null => {
    const match = textContent.match(TABLE_ROW_REG_EXP)
    if (!match || !match[1]) {
        return null
    }
    return match[1].split(/(?<=(?<!\\)(?:\\\\)*)\|/).map((text) => $createTableCell(text))
}

export const PLAYGROUND_TRANSFORMERS: Transformer[] = [
    HR,
    TABLE,
    CHECK_LIST,
    ...ELEMENT_TRANSFORMERS,
    ...MULTILINE_ELEMENT_TRANSFORMERS,
    ...TEXT_FORMAT_TRANSFORMERS,
    ...TEXT_MATCH_TRANSFORMERS,
]

// Lexical's CODE_SINGLE_LINE_REGEX, which it does not export: a ```code``` line opens no fence.
const CODE_SINGLE_LINE_REG_EXP = /^[ \t]*```[^`]+(?:(?:`{1,2}|`{4,})[^`]+)*```(?:[^`]|$)/

const strippedChunkCache = new Map<string, string>()

/**
 * The markdown export escapes every *, _, ` and ~ (and \ inside table cells), whether or not
 * reading the text back needs it. A prompt is saved without the escapes that change nothing on
 * reload, so the model reads `user_id` rather than `user\_id`, while the escapes a reload does
 * need (asterisks typed as text, a backslash in a code block) stay.
 *
 * Lines import one at a time, except for a code fence, so a line (or a whole fence) reloads the
 * same on its own as inside the prompt. Each one is cached, so a keystroke re-checks only the
 * line it changed.
 */
export function stripUnneededEscapes(markdown: string): string {
    let scratchEditor: LexicalEditor | undefined
    const reload = (text: string) => {
        scratchEditor ??= createEditor({
            nodes: [
                ...new Set(
                    PLAYGROUND_TRANSFORMERS.flatMap((transformer) =>
                        "dependencies" in transformer ? transformer.dependencies : [],
                    ),
                ),
            ],
            onError: console.error,
        })
        let reloaded = ""
        scratchEditor.update(
            () => {
                $convertFromMarkdownString(text, PLAYGROUND_TRANSFORMERS, undefined, true)
                reloaded = $convertToMarkdownStringCustom(PLAYGROUND_TRANSFORMERS, undefined, true)
                for (const {node} of $dfs()) {
                    if ($isTableNode(node)) tableDividerMap.delete(node.getKey())
                }
            },
            {discrete: true},
        )
        return reloaded
    }

    const stripChunk = (chunk: string) => {
        const cached = strippedChunkCache.get(chunk)
        if (cached !== undefined) {
            return cached
        }
        const escapes = findBackslashEscapes(chunk)
        if (escapes.length === 0) {
            return chunk
        }

        const without = (dropped: Set<number>) =>
            chunk
                .split("")
                .filter((_, index) => !dropped.has(index))
                .join("")
        const expected = reload(chunk)
        const dropped = new Set<number>()
        // Drop a whole run of escapes at once and split the run only when that changes the
        // reload, so a chunk that needs no escapes costs a single extra reload.
        const tryDropping = (run: number[]) => {
            if (reload(without(new Set([...dropped, ...run]))) === expected) {
                run.forEach((index) => dropped.add(index))
            } else if (run.length > 1) {
                const middle = Math.floor(run.length / 2)
                tryDropping(run.slice(0, middle))
                tryDropping(run.slice(middle))
            }
        }
        tryDropping(escapes)

        const stripped = without(dropped)
        if (strippedChunkCache.size >= 1000) strippedChunkCache.clear()
        strippedChunkCache.set(chunk, stripped)
        return stripped
    }

    const chunks: string[] = []
    let chunkLines: string[] = []
    let inCodeFence = false
    for (const line of markdown.split("\n")) {
        if (CODE.regExpStart.test(line) && !CODE_SINGLE_LINE_REG_EXP.test(line)) {
            inCodeFence = !inCodeFence
        }
        chunkLines.push(line)
        if (!inCodeFence) {
            chunks.push(chunkLines.join("\n"))
            chunkLines = []
        }
    }
    if (chunkLines.length > 0) chunks.push(chunkLines.join("\n"))
    return chunks.map(stripChunk).join("\n")
}
