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
    $getRoot,
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
                            // Double each backslash run before "n", a line break or "|", then escape the last two.
                            .replace(
                                /(\\*)(n|\n|\|)/g,
                                (_, backslashes: string, char: string) =>
                                    backslashes +
                                    backslashes +
                                    (char === "n" ? "" : "\\") +
                                    (char === "\n" ? "n" : char),
                            )
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

// Halve each backslash run before "n" or "|"; an odd run before "n" was a line break.
const $createTableCell = (textContent: string): TableCellNode => {
    textContent = textContent.replace(
        /(\\*)(n|\|)/g,
        (_, backslashes: string, char: string) =>
            "\\".repeat(Math.floor(backslashes.length / 2)) +
            (char === "n" && backslashes.length % 2 === 1 ? "\n" : char),
    )
    const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS)
    $convertFromMarkdownString(textContent, PLAYGROUND_TRANSFORMERS, cell)
    return cell
}

const mapToTableCells = (textContent: string): TableCellNode[] | null => {
    const match = textContent.match(TABLE_ROW_REG_EXP)
    if (!match || !match[1]) {
        return null
    }
    // A "|" after an odd backslash run belongs to the cell, so rows split only after an even one.
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

let scratchEditor: LexicalEditor | undefined
const getScratchEditor = () =>
    (scratchEditor ??= createEditor({
        nodes: [
            ...new Set(
                PLAYGROUND_TRANSFORMERS.flatMap((transformer) =>
                    "dependencies" in transformer ? transformer.dependencies : [],
                ),
            ),
        ],
        onError: console.error,
    }))

const strippedLineCache = new Map<string, string>()

/** Keeps only the escapes a reload needs, so the model reads `user_id` rather than `user\_id`. */
export function stripUnneededEscapes(markdown: string): string {
    // null when the reload fails, so the line keeps its escapes.
    const reload = (text: string): string | null => {
        let reloaded: string | null = null
        getScratchEditor().update(
            () => {
                $convertFromMarkdownString(text, PLAYGROUND_TRANSFORMERS, undefined, true)
                reloaded = $convertToMarkdownStringCustom(PLAYGROUND_TRANSFORMERS, undefined, true)
                // The scratch tables' dividers would otherwise pile up in tableDividerMap.
                for (const {node} of $dfs()) {
                    if ($isTableNode(node)) tableDividerMap.delete(node.getKey())
                }
            },
            {discrete: true},
        )
        return reloaded
    }

    // Lines outside a code fence import independently, so each is checked and cached on its own.
    const stripLine = (line: string) => {
        const cached = strippedLineCache.get(line)
        if (cached !== undefined) {
            return cached
        }
        const escapes = findBackslashEscapes(line)
        if (escapes.length === 0) {
            return line
        }
        const expected = reload(line)
        if (expected === null) {
            return line
        }

        const without = (dropped: Set<number>) =>
            line
                .split("")
                .filter((_, index) => !dropped.has(index))
                .join("")
        const dropped = new Set<number>()
        // Drop a whole run at once and split it only when that changes the reload.
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
        if (strippedLineCache.size >= 1000) strippedLineCache.clear()
        strippedLineCache.set(line, stripped)
        return stripped
    }

    const lines = markdown.split("\n")
    const saved: string[] = []
    for (let start = 0; start < lines.length; start++) {
        const startMatch = CODE.regExpStart.exec(lines[start])
        if (startMatch === null) {
            saved.push(stripLine(lines[start]))
            continue
        }
        // Code is exported unescaped, so a fence is kept as is, up to where Lexical's import ends it.
        let end = lines.length - 1
        getScratchEditor().update(
            () => {
                $getRoot().clear()
                end = CODE.handleImportAfterStartMatch!({
                    lines,
                    rootNode: $getRoot(),
                    startLineIndex: start,
                    startMatch,
                    transformer: CODE,
                })![1]
            },
            {discrete: true},
        )
        saved.push(...lines.slice(start, end + 1))
        start = end
    }
    return saved.join("\n")
}
