import {
    CHECK_LIST,
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
import {$isParagraphNode, $isTextNode, LexicalNode} from "lexical"

export function $convertToMarkdownStringCustom(
    transformers: Transformer[],
    editor?: unknown,
    selection?: unknown,
): string {
    const markdown = originalConvert(transformers, editor, selection)

    return markdown.replace(/{{(.*?)}}/g, (_, content) => {
        const unescapedContent = content.replace(/\\([\\`*{}\[\]()#+\-.!_>])/g, "$1")
        return `{{${unescapedContent}}}`
    })
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

        line.selectNext()
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
                            .trim(),
                    )
                    if (cell.__headerState === TableCellHeaderStates.ROW) {
                        isHeaderRow = true
                    }
                }
            }

            output.push(`| ${rowOutput.join(" | ")} |`)
            if (isHeaderRow) {
                output.push(`| ${rowOutput.map((_) => "---").join(" | ")} |`)
            }
        }

        return output.join("\n")
    },
    regExp: TABLE_ROW_REG_EXP,
    replace: (parentNode, _1, match) => {
        // Header row
        if (TABLE_ROW_DIVIDER_REG_EXP.test(match[0])) {
            const table = parentNode.getPreviousSibling()
            if (!table || !$isTableNode(table)) {
                return
            }

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

        table.selectEnd()
    },
    type: "element",
}

function getTableColumnsSize(table: TableNode) {
    const row = table.getFirstChild()
    return $isTableRowNode(row) ? row.getChildrenSize() : 0
}

const $createTableCell = (textContent: string): TableCellNode => {
    textContent = textContent.replace(/\\n/g, "\n")
    const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS)
    $convertFromMarkdownString(textContent, PLAYGROUND_TRANSFORMERS, cell)
    return cell
}

const mapToTableCells = (textContent: string): TableCellNode[] | null => {
    const match = textContent.match(TABLE_ROW_REG_EXP)
    if (!match || !match[1]) {
        return null
    }
    return match[1].split("|").map((text) => $createTableCell(text))
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
