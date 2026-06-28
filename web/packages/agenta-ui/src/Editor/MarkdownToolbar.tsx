/**
 * MarkdownToolbar
 *
 * A formatting toolbar for the rich-text Lexical editor: heading, bold, italic, lists, link, inline
 * code, quote, and tables. It reads the editor from composer context, so it must render inside an
 * `EditorProvider` (e.g. mounted by `MarkdownEditor` above the editor). Formatting applies to the
 * rich-text (rendered) view; pass `disabled` while the editor shows raw Markdown source.
 *
 * The link button opens a small popover that asks for the URL (and removes the link when one is
 * already under the caret) instead of blindly applying a placeholder. The table button opens a
 * size picker to insert a table; when the caret is inside a table, a second menu exposes row/column
 * insert + delete operations (mirroring the Lexical playground's table controls).
 */
import {type ReactNode, useCallback, useEffect, useState} from "react"

import {$createCodeNode, $isCodeNode} from "@lexical/code"
import {$isLinkNode, TOGGLE_LINK_COMMAND} from "@lexical/link"
import {INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, ListNode} from "@lexical/list"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {
    $createHeadingNode,
    $createQuoteNode,
    $isHeadingNode,
    $isQuoteNode,
} from "@lexical/rich-text"
import {$setBlocksType} from "@lexical/selection"
import {
    $deleteTableColumnAtSelection,
    $deleteTableRowAtSelection,
    $getTableCellNodeFromLexicalNode,
    $getTableNodeFromLexicalNodeOrThrow,
    $insertTableColumnAtSelection,
    $insertTableRowAtSelection,
    INSERT_TABLE_COMMAND,
} from "@lexical/table"
import {$getNearestNodeOfType} from "@lexical/utils"
import {Button, Dropdown, Input, type MenuProps, Popover} from "antd"
import {
    $createParagraphNode,
    $getSelection,
    $isRangeSelection,
    type ElementNode,
    FORMAT_TEXT_COMMAND,
    type TextFormatType,
} from "lexical"
import {
    Bold,
    ChevronDown,
    Code,
    Italic,
    Link as LinkIcon,
    List,
    ListOrdered,
    Table as TableIcon,
    Unlink,
} from "lucide-react"

const BLOCK_TYPES = [
    {key: "paragraph", label: "Normal text"},
    {key: "h1", label: "Heading 1"},
    {key: "h2", label: "Heading 2"},
    {key: "h3", label: "Heading 3"},
    {key: "quote", label: "Quote"},
    {key: "code", label: "Code block"},
] as const

export interface MarkdownToolbarProps {
    /** Disable the buttons (e.g. while the editor shows raw Markdown source or is read-only). */
    disabled?: boolean
}

const BTN_BASE =
    "flex h-7 w-7 items-center justify-center rounded border-0 bg-transparent transition-colors"
const btnClass = (disabled: boolean, isActive: boolean) =>
    [
        BTN_BASE,
        disabled
            ? "cursor-not-allowed text-[var(--ag-c-97A4B0,#97a4b0)] opacity-50"
            : "cursor-pointer text-[var(--ag-c-586673,#586673)] hover:bg-[var(--ag-c-EAEFF5,#eaeff5)]",
        isActive ? "bg-[var(--ag-c-EAEFF5,#eaeff5)] !text-[var(--ag-c-1677FF,#1677ff)]" : "",
    ].join(" ")

/** A compact rows×cols grid the user hovers to pick a table size, like Notion / the Lexical demo. */
function TableSizePicker({onPick}: {onPick: (rows: number, cols: number) => void}) {
    const MAX = 6
    const [hover, setHover] = useState({rows: 0, cols: 0})
    return (
        <div className="flex flex-col gap-1.5">
            <div
                className="grid w-fit gap-0.5"
                style={{gridTemplateColumns: `repeat(${MAX}, 1fr)`}}
                onMouseLeave={() => setHover({rows: 0, cols: 0})}
            >
                {Array.from({length: MAX * MAX}, (_, i) => {
                    const r = Math.floor(i / MAX) + 1
                    const c = (i % MAX) + 1
                    const on = r <= hover.rows && c <= hover.cols
                    return (
                        <button
                            key={i}
                            type="button"
                            aria-label={`${r} by ${c}`}
                            onMouseEnter={() => setHover({rows: r, cols: c})}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => onPick(r, c)}
                            className={[
                                "h-4 w-4 rounded-[2px] border border-solid transition-colors",
                                on
                                    ? "border-[var(--ant-color-primary)] bg-[var(--ant-color-primary)]"
                                    : "border-[var(--ant-color-border)] bg-[var(--ant-color-fill-quaternary)]",
                            ].join(" ")}
                        />
                    )
                })}
            </div>
            <span className="text-center text-[11px] text-[var(--ag-c-97A4B0,#97a4b0)]">
                {hover.rows > 0 ? `${hover.rows} × ${hover.cols}` : "Insert table"}
            </span>
        </div>
    )
}

export function MarkdownToolbar({disabled = false}: MarkdownToolbarProps) {
    const [editor] = useLexicalComposerContext()
    const [active, setActive] = useState({
        bold: false,
        italic: false,
        code: false,
        bullet: false,
        ordered: false,
        link: false,
        insideTable: false,
    })
    // The current block type (paragraph / h1-h3 / quote / code), shown in the block-type menu.
    const [blockType, setBlockType] = useState<string>("paragraph")
    // The URL under the caret (empty when not on a link), seeded into the link popover.
    const [linkUrl, setLinkUrl] = useState("")
    const [linkOpen, setLinkOpen] = useState(false)
    const [linkDraft, setLinkDraft] = useState("")
    const [tableOpen, setTableOpen] = useState(false)

    useEffect(() => {
        return editor.registerUpdateListener(({editorState}) => {
            editorState.read(() => {
                const selection = $getSelection()
                if (!$isRangeSelection(selection)) return
                const anchorNode = selection.anchor.getNode()
                const block = anchorNode.getTopLevelElement()
                const listNode = $getNearestNodeOfType(anchorNode, ListNode)
                const listType = listNode ? listNode.getListType() : null
                const parent = anchorNode.getParent()
                const linkNode = $isLinkNode(anchorNode)
                    ? anchorNode
                    : $isLinkNode(parent)
                      ? parent
                      : null
                setLinkUrl(linkNode ? linkNode.getURL() : "")
                setBlockType(
                    block && $isHeadingNode(block)
                        ? block.getTag()
                        : block && $isQuoteNode(block)
                          ? "quote"
                          : block && $isCodeNode(block)
                            ? "code"
                            : "paragraph",
                )
                setActive({
                    bold: selection.hasFormat("bold"),
                    italic: selection.hasFormat("italic"),
                    code: selection.hasFormat("code"),
                    bullet: listType === "bullet",
                    ordered: listType === "number",
                    link: Boolean(linkNode),
                    insideTable: $getTableCellNodeFromLexicalNode(anchorNode) !== null,
                })
            })
        })
    }, [editor])

    const formatText = useCallback(
        (format: TextFormatType) => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format),
        [editor],
    )

    const setBlock = useCallback(
        (create: () => ElementNode) => {
            editor.update(() => {
                const selection = $getSelection()
                if ($isRangeSelection(selection)) $setBlocksType(selection, create)
            })
        },
        [editor],
    )

    // Convert the current block to the chosen type. Headings/quote/code all go through
    // `$setBlocksType`; the markdown serializer maps them back to `#`, `>` and fenced blocks.
    const formatBlock = useCallback(
        (key: string) => {
            if (key === "quote") setBlock(() => $createQuoteNode())
            else if (key === "code") setBlock(() => $createCodeNode())
            else if (key === "h1" || key === "h2" || key === "h3")
                setBlock(() => $createHeadingNode(key))
            else setBlock(() => $createParagraphNode())
        },
        [setBlock],
    )

    // Apply / clear the link on the current selection. The editor keeps its last RangeSelection
    // while focus sits in the popover input, so the command still targets the selected text.
    const applyLink = useCallback(() => {
        const url = linkDraft.trim()
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, url || null)
        setLinkOpen(false)
    }, [editor, linkDraft])

    const removeLink = useCallback(() => {
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)
        setLinkOpen(false)
    }, [editor])

    const insertTable = useCallback(
        (rows: number, cols: number) => {
            editor.dispatchCommand(INSERT_TABLE_COMMAND, {
                rows: String(rows),
                columns: String(cols),
                includeHeaders: true,
            })
            setTableOpen(false)
        },
        [editor],
    )

    const runTableOp = useCallback((op: () => void) => editor.update(op), [editor])

    const tableMenu: MenuProps = {
        onClick: ({key, domEvent}) => {
            domEvent.preventDefault()
            switch (key) {
                case "row-above":
                    return runTableOp(() => $insertTableRowAtSelection(false))
                case "row-below":
                    return runTableOp(() => $insertTableRowAtSelection(true))
                case "col-left":
                    return runTableOp(() => $insertTableColumnAtSelection(false))
                case "col-right":
                    return runTableOp(() => $insertTableColumnAtSelection(true))
                case "del-row":
                    return runTableOp(() => $deleteTableRowAtSelection())
                case "del-col":
                    return runTableOp(() => $deleteTableColumnAtSelection())
                case "del-table":
                    return runTableOp(() => {
                        const sel = $getSelection()
                        if (!$isRangeSelection(sel)) return
                        const cell = $getTableCellNodeFromLexicalNode(sel.anchor.getNode())
                        if (!cell) return
                        $getTableNodeFromLexicalNodeOrThrow(cell).remove()
                    })
                default:
                    return undefined
            }
        },
        items: [
            {key: "row-above", label: "Insert row above"},
            {key: "row-below", label: "Insert row below"},
            {key: "col-left", label: "Insert column left"},
            {key: "col-right", label: "Insert column right"},
            {type: "divider"},
            {key: "del-row", label: "Delete row"},
            {key: "del-col", label: "Delete column"},
            {key: "del-table", label: "Delete table", danger: true},
        ],
    }

    const button = (
        key: string,
        label: string,
        icon: ReactNode,
        onClick: () => void,
        isActive = false,
    ) => (
        <button
            key={key}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={isActive}
            disabled={disabled}
            // Keep focus (and the selection) in the editor so the command applies to the selected
            // text instead of being lost when the button steals focus.
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClick}
            className={btnClass(disabled, isActive)}
        >
            {icon}
        </button>
    )

    const divider = (
        <span className="mx-0.5 h-4 w-px shrink-0 bg-[var(--ag-c-EAEFF5,#eaeff5)]" aria-hidden />
    )

    const blockLabel = BLOCK_TYPES.find((b) => b.key === blockType)?.label ?? "Normal text"

    return (
        <div className="flex items-center gap-0.5">
            {/* Block type — paragraph / headings / quote / code block. */}
            <Dropdown
                disabled={disabled}
                trigger={["click"]}
                placement="bottomLeft"
                menu={{
                    selectable: true,
                    selectedKeys: [blockType],
                    items: BLOCK_TYPES.map((b) => ({key: b.key, label: b.label})),
                    onClick: ({key, domEvent}) => {
                        domEvent.preventDefault()
                        formatBlock(key)
                    },
                }}
            >
                <button
                    type="button"
                    title="Text style"
                    aria-label="Text style"
                    disabled={disabled}
                    onMouseDown={(e) => e.preventDefault()}
                    className={`${btnClass(disabled, false)} !w-auto min-w-[88px] justify-between gap-1 px-2 text-xs`}
                >
                    <span className="truncate">{blockLabel}</span>
                    <ChevronDown size={13} className="shrink-0" />
                </button>
            </Dropdown>
            {divider}
            {button("b", "Bold", <Bold size={15} />, () => formatText("bold"), active.bold)}
            {button("i", "Italic", <Italic size={15} />, () => formatText("italic"), active.italic)}
            {button(
                "code",
                "Inline code",
                <Code size={15} />,
                () => formatText("code"),
                active.code,
            )}
            {divider}
            {button(
                "ul",
                "Bulleted list",
                <List size={15} />,
                () => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
                active.bullet,
            )}
            {button(
                "ol",
                "Numbered list",
                <ListOrdered size={15} />,
                () => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
                active.ordered,
            )}
            {divider}

            {/* Link — popover asks for the URL (and removes an existing link). */}
            <Popover
                open={disabled ? false : linkOpen}
                onOpenChange={(next) => {
                    setLinkOpen(next)
                    if (next) setLinkDraft(linkUrl)
                }}
                trigger="click"
                placement="bottom"
                destroyTooltipOnHide
                content={
                    <div className="flex w-60 flex-col gap-2">
                        <Input
                            autoFocus
                            value={linkDraft}
                            placeholder="https://example.com"
                            onChange={(e) => setLinkDraft(e.target.value)}
                            onPressEnter={applyLink}
                        />
                        <div className="flex items-center justify-between gap-2">
                            {active.link ? (
                                <Button
                                    type="text"
                                    size="small"
                                    danger
                                    icon={<Unlink size={13} />}
                                    onClick={removeLink}
                                >
                                    Remove
                                </Button>
                            ) : (
                                <span />
                            )}
                            <Button type="primary" size="small" onClick={applyLink}>
                                {active.link ? "Update" : "Add link"}
                            </Button>
                        </div>
                    </div>
                }
            >
                <button
                    type="button"
                    title="Link"
                    aria-label="Link"
                    aria-pressed={active.link}
                    disabled={disabled}
                    onMouseDown={(e) => e.preventDefault()}
                    className={btnClass(disabled, active.link)}
                >
                    <LinkIcon size={15} />
                </button>
            </Popover>

            {/* Table — one control: inside a table it opens the row/column ops menu; otherwise a
                size picker to insert one. The chevron signals the menu when the caret is in a table. */}
            {active.insideTable && !disabled ? (
                <Dropdown menu={tableMenu} trigger={["click"]} placement="bottomLeft">
                    <button
                        type="button"
                        title="Table options"
                        aria-label="Table options"
                        onMouseDown={(e) => e.preventDefault()}
                        className={`${btnClass(false, false)} !w-auto gap-0.5 px-1`}
                    >
                        <TableIcon size={15} />
                        <ChevronDown size={12} />
                    </button>
                </Dropdown>
            ) : (
                <Popover
                    open={disabled ? false : tableOpen}
                    onOpenChange={setTableOpen}
                    trigger="click"
                    placement="bottom"
                    destroyTooltipOnHide
                    content={<TableSizePicker onPick={insertTable} />}
                >
                    <button
                        type="button"
                        title="Insert table"
                        aria-label="Insert table"
                        disabled={disabled}
                        onMouseDown={(e) => e.preventDefault()}
                        className={btnClass(disabled, false)}
                    >
                        <TableIcon size={15} />
                    </button>
                </Popover>
            )}
        </div>
    )
}
