/**
 * Table cell resizer plugin for Lexical editor.
 * Adapted from the Lexical playground reference implementation.
 * Enables drag-to-resize for table columns and rows.
 */
import {
    type CSSProperties,
    type PointerEventHandler,
    type ReactPortal,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {useLexicalEditable} from "@lexical/react/useLexicalEditable"
import type {TableCellNode, TableDOMCell, TableMapType} from "@lexical/table"
import {
    $computeTableMapSkipCellCheck,
    $getTableNodeFromLexicalNodeOrThrow,
    $getTableRowIndexFromTableCellNode,
    $isTableCellNode,
    $isTableRowNode,
    getDOMCellFromTarget,
    getTableElement,
    TableNode,
} from "@lexical/table"
import {calculateZoomLevel, mergeRegister} from "@lexical/utils"
import type {LexicalEditor, NodeKey} from "lexical"
import {$getNearestNodeFromDOMNode, isHTMLElement, SKIP_SCROLL_INTO_VIEW_TAG} from "lexical"
import {createPortal} from "react-dom"

interface PointerPosition {
    x: number
    y: number
}

type PointerDraggingDirection = "right" | "bottom"

const MIN_ROW_HEIGHT = 33
const MIN_COLUMN_WIDTH = 50
const ACTIVE_RESIZER_COLOR = "#76b6ff"

function TableCellResizer({editor}: {editor: LexicalEditor}) {
    const targetRef = useRef<HTMLElement | null>(null)
    const resizerRef = useRef<HTMLDivElement | null>(null)
    const tableRectRef = useRef<DOMRect | null>(null)
    const [hasTable, setHasTable] = useState(false)

    const pointerStartPosRef = useRef<PointerPosition | null>(null)
    const [pointerCurrentPos, updatePointerCurrentPos] = useState<PointerPosition | null>(null)

    const [activeCell, updateActiveCell] = useState<TableDOMCell | null>(null)
    const [draggingDirection, updateDraggingDirection] = useState<PointerDraggingDirection | null>(
        null,
    )
    const [hoveredDirection, updateHoveredDirection] = useState<PointerDraggingDirection | null>(
        null,
    )

    const resetState = useCallback(() => {
        updateActiveCell(null)
        targetRef.current = null
        updateDraggingDirection(null)
        updateHoveredDirection(null)
        pointerStartPosRef.current = null
        tableRectRef.current = null
    }, [])

    useEffect(() => {
        const tableKeys = new Set<NodeKey>()
        return mergeRegister(
            editor.registerMutationListener(TableNode, (nodeMutations) => {
                for (const [nodeKey, mutation] of nodeMutations) {
                    if (mutation === "destroyed") {
                        tableKeys.delete(nodeKey)
                    } else {
                        tableKeys.add(nodeKey)
                    }
                }
                setHasTable(tableKeys.size > 0)
            }),
            editor.registerNodeTransform(TableNode, (tableNode) => {
                if (tableNode.getColWidths()) {
                    return tableNode
                }
                const numColumns = tableNode.getColumnCount()
                tableNode.setColWidths(Array(numColumns).fill(MIN_COLUMN_WIDTH))
                return tableNode
            }),
        )
    }, [editor])

    useEffect(() => {
        if (!hasTable) {
            return
        }

        const onPointerMove = (event: PointerEvent) => {
            const target = event.target
            if (!isHTMLElement(target)) {
                return
            }

            if (draggingDirection) {
                event.preventDefault()
                event.stopPropagation()
                updatePointerCurrentPos({
                    x: event.clientX,
                    y: event.clientY,
                })
                return
            }
            if (resizerRef.current && resizerRef.current.contains(target)) {
                return
            }

            if (targetRef.current !== target) {
                targetRef.current = target
                const cell = getDOMCellFromTarget(target)

                if (cell && activeCell !== cell) {
                    editor.getEditorState().read(
                        () => {
                            const tableCellNode = $getNearestNodeFromDOMNode(cell.elem)
                            if (!tableCellNode) {
                                throw new Error("TableCellResizer: Table cell node not found.")
                            }

                            const tableNode = $getTableNodeFromLexicalNodeOrThrow(tableCellNode)
                            const tableElement = getTableElement(
                                tableNode,
                                editor.getElementByKey(tableNode.getKey()),
                            )

                            if (!tableElement) {
                                throw new Error("TableCellResizer: Table element not found.")
                            }

                            targetRef.current = target
                            tableRectRef.current = tableElement.getBoundingClientRect()
                            updateActiveCell(cell)
                        },
                        {editor},
                    )
                } else if (cell == null) {
                    resetState()
                }
            }
        }

        const onPointerDown = (event: PointerEvent) => {
            if (event.pointerType === "touch") {
                onPointerMove(event)
            }
        }

        const resizerContainer = resizerRef.current
        resizerContainer?.addEventListener("pointermove", onPointerMove, {
            capture: true,
        })

        const removeRootListener = editor.registerRootListener((rootElement, prevRootElement) => {
            prevRootElement?.removeEventListener("pointermove", onPointerMove)
            prevRootElement?.removeEventListener("pointerdown", onPointerDown)
            rootElement?.addEventListener("pointermove", onPointerMove)
            rootElement?.addEventListener("pointerdown", onPointerDown)
        })

        return () => {
            removeRootListener()
            resizerContainer?.removeEventListener("pointermove", onPointerMove)
        }
    }, [activeCell, draggingDirection, editor, resetState, hasTable])

    const isHeightChanging = (direction: PointerDraggingDirection) => {
        return direction === "bottom"
    }

    const updateRowHeight = useCallback(
        (heightChange: number) => {
            if (!activeCell) {
                throw new Error("TableCellResizer: Expected active cell.")
            }

            editor.update(
                () => {
                    const tableCellNode = $getNearestNodeFromDOMNode(activeCell.elem)
                    if (!$isTableCellNode(tableCellNode)) {
                        throw new Error("TableCellResizer: Table cell node not found.")
                    }

                    const tableNode = $getTableNodeFromLexicalNodeOrThrow(tableCellNode)
                    const baseRowIndex = $getTableRowIndexFromTableCellNode(tableCellNode)
                    const tableRows = tableNode.getChildren()

                    const isFullRowMerge = tableCellNode.getColSpan() === tableNode.getColumnCount()

                    const tableRowIndex = isFullRowMerge
                        ? baseRowIndex
                        : baseRowIndex + tableCellNode.getRowSpan() - 1

                    if (tableRowIndex >= tableRows.length || tableRowIndex < 0) {
                        throw new Error("Expected table cell to be inside of table row.")
                    }

                    const tableRow = tableRows[tableRowIndex]

                    if (!$isTableRowNode(tableRow)) {
                        throw new Error("Expected table row")
                    }

                    let height = tableRow.getHeight()
                    if (height === undefined) {
                        const rowCells = tableRow.getChildren<TableCellNode>()
                        height = Math.min(
                            ...rowCells.map((cell) => getCellNodeHeight(cell, editor) ?? Infinity),
                        )
                    }

                    const newHeight = Math.max(height + heightChange, MIN_ROW_HEIGHT)
                    tableRow.setHeight(newHeight)
                },
                {tag: SKIP_SCROLL_INTO_VIEW_TAG},
            )
        },
        [activeCell, editor],
    )

    const getCellNodeHeight = (
        cell: TableCellNode,
        activeEditor: LexicalEditor,
    ): number | undefined => {
        const domCellNode = activeEditor.getElementByKey(cell.getKey())
        return domCellNode?.clientHeight
    }

    const getCellColumnIndex = (tableCellNode: TableCellNode, tableMap: TableMapType) => {
        for (const row of tableMap) {
            for (let column = 0; column < row.length; column++) {
                if (row[column].cell === tableCellNode) {
                    // Return the rightmost column of this cell (for colSpan > 1)
                    return column + tableCellNode.getColSpan() - 1
                }
            }
        }
    }

    const updateColumnWidth = useCallback(
        (widthChange: number) => {
            if (!activeCell) {
                throw new Error("TableCellResizer: Expected active cell.")
            }
            editor.update(
                () => {
                    const tableCellNode = $getNearestNodeFromDOMNode(activeCell.elem)
                    if (!$isTableCellNode(tableCellNode)) {
                        throw new Error("TableCellResizer: Table cell node not found.")
                    }

                    const tableNode = $getTableNodeFromLexicalNodeOrThrow(tableCellNode)
                    const tableElement = getTableElement(
                        tableNode,
                        editor.getElementByKey(tableNode.getKey()),
                    )
                    if (!tableElement) {
                        throw new Error("TableCellResizer: Table element not found.")
                    }

                    const [tableMap] = $computeTableMapSkipCellCheck(tableNode, null, null)
                    const columnIndex = getCellColumnIndex(tableCellNode, tableMap)
                    if (columnIndex === undefined) {
                        throw new Error("TableCellResizer: Table column not found.")
                    }

                    // Read actual rendered column widths from the DOM rather than
                    // relying on stored colWidths (which may be MIN_COLUMN_WIDTH
                    // while the table is stretched to 100% width by CSS).
                    const numColumns = tableNode.getColumnCount()
                    const newColWidths: number[] = []
                    const firstRow = tableElement.querySelector("tr")
                    if (firstRow) {
                        const cells = firstRow.querySelectorAll("td, th")
                        for (let i = 0; i < numColumns; i++) {
                            const cell = cells[i] as HTMLElement | undefined
                            newColWidths.push(cell ? cell.offsetWidth : MIN_COLUMN_WIDTH)
                        }
                    } else {
                        const colWidths = tableNode.getColWidths()
                        for (let i = 0; i < numColumns; i++) {
                            newColWidths.push(colWidths?.[i] ?? MIN_COLUMN_WIDTH)
                        }
                    }

                    const currentWidth = newColWidths[columnIndex]
                    const newWidth = Math.max(currentWidth + widthChange, MIN_COLUMN_WIDTH)
                    newColWidths[columnIndex] = newWidth
                    tableNode.setColWidths(newColWidths)
                },
                {tag: SKIP_SCROLL_INTO_VIEW_TAG},
            )
        },
        [activeCell, editor],
    )

    const pointerUpHandler = useCallback(
        (direction: PointerDraggingDirection) => {
            const handler = (event: PointerEvent) => {
                event.preventDefault()
                event.stopPropagation()

                if (!activeCell) {
                    throw new Error("TableCellResizer: Expected active cell.")
                }

                if (pointerStartPosRef.current) {
                    const {x, y} = pointerStartPosRef.current

                    if (activeCell === null) {
                        return
                    }
                    const zoom = calculateZoomLevel(event.target as Element)

                    if (isHeightChanging(direction)) {
                        const heightChange = (event.clientY - y) / zoom
                        updateRowHeight(heightChange)
                    } else {
                        const widthChange = (event.clientX - x) / zoom
                        updateColumnWidth(widthChange)
                    }

                    resetState()
                    document.removeEventListener("pointerup", handler)
                }
            }
            return handler
        },
        [activeCell, resetState, updateColumnWidth, updateRowHeight],
    )

    const toggleResize = useCallback(
        (direction: PointerDraggingDirection): PointerEventHandler<HTMLDivElement> =>
            (event) => {
                event.preventDefault()
                event.stopPropagation()

                if (!activeCell) {
                    throw new Error("TableCellResizer: Expected active cell.")
                }

                pointerStartPosRef.current = {
                    x: event.clientX,
                    y: event.clientY,
                }
                updatePointerCurrentPos(pointerStartPosRef.current)
                updateDraggingDirection(direction)

                document.addEventListener("pointerup", pointerUpHandler(direction))
            },
        [activeCell, pointerUpHandler],
    )

    const getResizers = useCallback(() => {
        if (activeCell) {
            const {height, width, top, left} = activeCell.elem.getBoundingClientRect()
            const zoom = calculateZoomLevel(activeCell.elem)
            const zoneWidth = 16
            const styles: Record<string, CSSProperties> = {
                bottom: {
                    backgroundColor: "transparent",
                    cursor: "row-resize",
                    height: `${zoneWidth}px`,
                    left: `${window.scrollX + left}px`,
                    top: `${window.scrollY + top + height - zoneWidth / 2}px`,
                    width: `${width}px`,
                },
                right: {
                    backgroundColor: "transparent",
                    cursor: "col-resize",
                    height: `${height}px`,
                    left: `${window.scrollX + left + width - zoneWidth / 2}px`,
                    top: `${window.scrollY + top}px`,
                    width: `${zoneWidth}px`,
                },
            }

            const tableRect = tableRectRef.current

            if (draggingDirection && pointerCurrentPos && tableRect) {
                if (isHeightChanging(draggingDirection)) {
                    styles[draggingDirection].left = `${window.scrollX + tableRect.left}px`
                    styles[draggingDirection].top = `${
                        window.scrollY + pointerCurrentPos.y / zoom
                    }px`
                    styles[draggingDirection].height = "3px"
                    styles[draggingDirection].width = `${tableRect.width}px`
                } else {
                    styles[draggingDirection].top = `${window.scrollY + tableRect.top}px`
                    styles[draggingDirection].left = `${
                        window.scrollX + pointerCurrentPos.x / zoom
                    }px`
                    styles[draggingDirection].width = "3px"
                    styles[draggingDirection].height = `${tableRect.height}px`
                }

                styles[draggingDirection].backgroundColor = "#adf"
                styles[draggingDirection].mixBlendMode = "unset"
            } else if (!draggingDirection && hoveredDirection === "right") {
                const halfZoneWidth = zoneWidth / 2
                const highlightWidth = 2
                const highlightStart = halfZoneWidth - highlightWidth / 2
                styles.right.backgroundImage = `linear-gradient(90deg, transparent ${highlightStart}px, ${ACTIVE_RESIZER_COLOR} ${highlightStart}px, ${ACTIVE_RESIZER_COLOR} ${
                    highlightStart + highlightWidth
                }px, transparent ${highlightStart + highlightWidth}px)`
                styles.right.mixBlendMode = "unset"
                if (tableRect) {
                    styles.right.top = `${window.scrollY + tableRect.top}px`
                    styles.right.height = `${tableRect.height}px`
                }
            }

            return styles
        }

        return {
            bottom: null,
            right: null,
        }
    }, [activeCell, draggingDirection, hoveredDirection, pointerCurrentPos])

    const handlePointerEnter = useCallback(
        (direction: PointerDraggingDirection): PointerEventHandler<HTMLDivElement> =>
            () => {
                if (!draggingDirection) {
                    updateHoveredDirection(direction)
                }
            },
        [draggingDirection],
    )

    const handlePointerLeave = useCallback(() => {
        if (!draggingDirection) {
            updateHoveredDirection(null)
        }
    }, [draggingDirection])

    const resizerStyles = getResizers()

    return (
        <div ref={resizerRef}>
            {activeCell != null && (
                <>
                    <div
                        className="TableCellResizer__resizer"
                        style={resizerStyles.right || undefined}
                        onPointerEnter={handlePointerEnter("right")}
                        onPointerLeave={handlePointerLeave}
                        onPointerDown={toggleResize("right")}
                    />
                    <div
                        className="TableCellResizer__resizer"
                        style={resizerStyles.bottom || undefined}
                        onPointerDown={toggleResize("bottom")}
                    />
                </>
            )}
        </div>
    )
}

export default function TableCellResizerPlugin(): null | ReactPortal {
    const [editor] = useLexicalComposerContext()
    const isEditable = useLexicalEditable()

    return useMemo(
        () =>
            isEditable ? createPortal(<TableCellResizer editor={editor} />, document.body) : null,
        [editor, isEditable],
    )
}
