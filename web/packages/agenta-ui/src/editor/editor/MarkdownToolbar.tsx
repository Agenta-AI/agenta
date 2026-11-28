/** Formatting toolbar for the rich-text Lexical editor; render it inside an `EditorProvider`. */
import {
    type KeyboardEvent,
    type ReactElement,
    type ReactNode,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import uiEditorCatalog from "@agenta/i18n/catalogs/ui.editor"
import {shortcutFaces} from "@agenta/shared/utils"
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
import {
    CaretDownIcon,
    CodeIcon,
    LinkBreakIcon,
    LinkIcon as LinkIcon,
    ListIcon,
    ListNumbersIcon,
    QuotesIcon,
    TableIcon as TableIcon,
    TextBIcon,
    TextItalicIcon,
    TextStrikethroughIcon,
} from "@phosphor-icons/react"
import {
    $createParagraphNode,
    $getRoot,
    $getSelection,
    $isRangeSelection,
    $setSelection,
    type BaseSelection,
    type ElementNode,
    type LexicalNode,
    FORMAT_TEXT_COMMAND,
    type TextFormatType,
} from "lexical"

import {SimpleTooltip} from "../../composed/feedback/simple-tooltip"
import {useScrollFadeEdges} from "../../foundation/hooks/useScrollFadeEdges"
import {cn} from "../../foundation/utils/cn"
import {Button} from "../../primitives/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "../../primitives/dropdown-menu"
import {Input} from "../../primitives/input"
import {Popover, PopoverContent, PopoverTrigger} from "../../primitives/popover"
import {useIsMacPlatform} from "../../shell/shortcuts/ShortcutKeys"

const BLOCK_TYPES = [
    {key: "paragraph", labelKey: "ui.editor.normalText"},
    {key: "h1", labelKey: "ui.editor.heading1"},
    {key: "h2", labelKey: "ui.editor.heading2"},
    {key: "h3", labelKey: "ui.editor.heading3"},
    {key: "quote", labelKey: "ui.editor.quote"},
    {key: "code", labelKey: "ui.editor.codeBlock"},
] as const

export interface MarkdownToolbarProps {
    /** Disable the buttons (e.g. while the editor shows raw Markdown source or is read-only). */
    disabled?: boolean
    /** `default`: block select, B, I, S, code, list, table. `inline`: H1-H3, lists, quote, link. */
    layout?: "default" | "inline"
}

// Quiet icon buttons; aria-pressed shows the kit's selected look.
const TOOL_CLASS =
    "text-muted-foreground hover:text-foreground aria-pressed:bg-selected aria-pressed:text-foreground"

/** A tooltip over a Radix `asChild` trigger: the span keeps the two triggers apart. */
const Tip = ({title, children}: {title: string; children: ReactElement}) => (
    <SimpleTooltip title={title}>
        <span className="inline-flex shrink-0">{children}</span>
    </SimpleTooltip>
)

/** Keep focus (and the Lexical selection) in the editor when a menu item is pressed. */
const keepEditorSelection = (e: {preventDefault: () => void}) => e.preventDefault()

/** A compact rows×cols grid the user hovers to pick a table size, like Notion / the Lexical demo. */
function TableSizePicker({onPick}: {onPick: (rows: number, cols: number) => void}) {
    const t = useT(uiEditorCatalog, commonCatalog)
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
                            aria-label={t("ui.editor.tableSize", {rows: r, columns: c})}
                            onMouseEnter={() => setHover({rows: r, cols: c})}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => onPick(r, c)}
                            className={[
                                "h-4 w-4 rounded-sm border border-solid transition-colors",
                                on ? "border-border-strong bg-selected" : "border-border bg-muted",
                            ].join(" ")}
                        />
                    )
                })}
            </div>
            <span className="text-center text-meta text-muted-foreground">
                {hover.rows > 0 ? `${hover.rows} × ${hover.cols}` : t("ui.editor.insertTable")}
            </span>
        </div>
    )
}

/** The block-type menu's key for a top-level block. */
const blockTypeOf = (block: LexicalNode | null): string =>
    block && $isHeadingNode(block)
        ? block.getTag()
        : block && $isQuoteNode(block)
          ? "quote"
          : block && $isCodeNode(block)
            ? "code"
            : "paragraph"

/** The block under the caret, or the first block before the editor has a caret. */
const $currentBlockType = (): string => {
    const selection = $getSelection()
    if ($isRangeSelection(selection))
        return blockTypeOf(selection.anchor.getNode().getTopLevelElement())
    return blockTypeOf($getRoot().getFirstChild())
}

export function MarkdownToolbar({disabled = false, layout = "default"}: MarkdownToolbarProps) {
    const t = useT(uiEditorCatalog, commonCatalog)
    const [editor] = useLexicalComposerContext()
    const [active, setActive] = useState({
        bold: false,
        italic: false,
        strikethrough: false,
        code: false,
        bullet: false,
        ordered: false,
        link: false,
        insideTable: false,
    })
    // The current block type (paragraph / h1-h3 / quote / code), shown in the block-type menu.
    // Read at mount, so the menu does not flip from "Normal text" when the caret lands.
    const [blockType, setBlockType] = useState<string>(() =>
        editor.getEditorState().read($currentBlockType),
    )
    // The URL under the caret (empty when not on a link), seeded into the link popover.
    const [linkUrl, setLinkUrl] = useState("")
    const [linkOpen, setLinkOpen] = useState(false)
    const [linkDraft, setLinkDraft] = useState("")
    const [tableOpen, setTableOpen] = useState(false)
    // The editor selection when the link popover opened, restored before the link applies.
    const linkSelection = useRef<BaseSelection | null>(null)
    const scrollRef = useRef<HTMLDivElement | null>(null)
    useScrollFadeEdges(scrollRef, {axis: "x"})
    const iconSize = layout === "default" ? "icon-xs" : "icon-compact"
    const mac = useIsMacPlatform()
    // Lexical's own bindings for bold and italic.
    const modKey = (key: string) => shortcutFaces({modifiers: ["mod"], key}, mac)

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
                setBlockType(blockTypeOf(block))
                setActive({
                    bold: selection.hasFormat("bold"),
                    italic: selection.hasFormat("italic"),
                    strikethrough: selection.hasFormat("strikethrough"),
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

    // A multi-line code block is one code node with the text written back (not one node per line).
    const formatBlock = useCallback(
        (key: string) => {
            if (key === "code") {
                editor.update(() => {
                    const selection = $getSelection()
                    if (!$isRangeSelection(selection)) return
                    if (selection.isCollapsed()) {
                        $setBlocksType(selection, () => $createCodeNode())
                    } else {
                        const text = selection.getTextContent()
                        selection.insertNodes([$createCodeNode()])
                        const next = $getSelection()
                        if ($isRangeSelection(next)) next.insertRawText(text)
                    }
                })
                return
            }
            if (key === "quote") setBlock(() => $createQuoteNode())
            else if (key === "h1" || key === "h2" || key === "h3")
                setBlock(() => $createHeadingNode(key))
            else setBlock(() => $createParagraphNode())
        },
        [editor, setBlock],
    )

    const toggleLink = useCallback(
        (url: string | null) => {
            const saved = linkSelection.current
            editor.update(() => {
                if (saved) $setSelection(saved.clone())
                editor.dispatchCommand(TOGGLE_LINK_COMMAND, url)
            })
            setLinkOpen(false)
        },
        [editor],
    )

    const applyLink = useCallback(
        () => toggleLink(linkDraft.trim() || null),
        [toggleLink, linkDraft],
    )
    const removeLink = useCallback(() => toggleLink(null), [toggleLink])

    // Keep Enter and Escape out of the editor: Enter there would replace the selected text.
    const onLinkKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key !== "Enter" && e.key !== "Escape") return
        e.preventDefault()
        e.stopPropagation()
        if (e.key === "Enter") applyLink()
        else setLinkOpen(false)
    }

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

    const deleteTable = useCallback(
        () =>
            runTableOp(() => {
                const sel = $getSelection()
                if (!$isRangeSelection(sel)) return
                const cell = $getTableCellNodeFromLexicalNode(sel.anchor.getNode())
                if (!cell) return
                $getTableNodeFromLexicalNodeOrThrow(cell).remove()
            }),
        [runTableOp],
    )

    const button = (
        key: string,
        label: string,
        icon: ReactNode,
        onClick: () => void,
        isActive = false,
        shortcut?: string[],
    ) => (
        <SimpleTooltip key={key} title={label} shortcut={shortcut}>
            <Button
                type="button"
                variant="ghost"
                size={iconSize}
                aria-label={label}
                aria-pressed={isActive}
                disabled={disabled}
                // Keep focus (and the selection) in the editor.
                onMouseDown={keepEditorSelection}
                onClick={onClick}
                className={TOOL_CLASS}
            >
                {icon}
            </Button>
        </SimpleTooltip>
    )

    const divider =
        layout === "default" ? (
            <span className="mx-1 h-4 w-px shrink-0 bg-border-muted" aria-hidden />
        ) : (
            <span className="mx-0.5 h-4 w-px shrink-0 bg-border-muted" aria-hidden />
        )

    const blockLabel = t(
        BLOCK_TYPES.find((b) => b.key === blockType)?.labelKey ?? "ui.editor.normalText",
    )

    // Pressing the active level returns the block to a paragraph.
    const headingButton = (level: "h1" | "h2" | "h3") =>
        button(
            level,
            level === "h1"
                ? t("ui.editor.heading1")
                : level === "h2"
                  ? t("ui.editor.heading2")
                  : t("ui.editor.heading3"),
            <span className="text-caption font-semibold tracking-wide">{level.toUpperCase()}</span>,
            () => formatBlock(blockType === level ? "paragraph" : level),
            blockType === level,
        )

    return (
        // Narrow widths scroll sideways with faded edges instead of wrapping.
        <div
            ref={scrollRef}
            className={cn(
                "ag-scroll-fade-x flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                layout === "inline" ? "flex-nowrap" : "sm:flex-wrap sm:overflow-x-visible",
            )}
        >
            {layout === "inline" ? (
                <>
                    {headingButton("h1")}
                    {headingButton("h2")}
                    {headingButton("h3")}
                </>
            ) : (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild disabled={disabled}>
                        <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            aria-label={t("ui.editor.textStyle")}
                            disabled={disabled}
                            onMouseDown={keepEditorSelection}
                            className="min-w-28 justify-between"
                        >
                            <span className="truncate">{blockLabel}</span>
                            <CaretDownIcon className="ag-caret shrink-0 text-muted-foreground" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                        {BLOCK_TYPES.map((b) => (
                            <DropdownMenuItem
                                key={b.key}
                                className={cn(b.key === blockType && "bg-selected text-foreground")}
                                onMouseDown={keepEditorSelection}
                                onSelect={() => formatBlock(b.key)}
                            >
                                {t(b.labelKey)}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}

            {divider}
            {button(
                "b",
                t("ui.editor.bold"),
                <TextBIcon size={14} />,
                () => formatText("bold"),
                active.bold,
                modKey("B"),
            )}
            {button(
                "i",
                t("ui.editor.italic"),
                <TextItalicIcon size={14} />,
                () => formatText("italic"),
                active.italic,
                modKey("I"),
            )}
            {button(
                "s",
                t("ui.editor.strikethrough"),
                <TextStrikethroughIcon size={14} />,
                () => formatText("strikethrough"),
                active.strikethrough,
            )}
            {button(
                "code",
                t("ui.editor.inlineCode"),
                <CodeIcon size={14} />,
                () => formatText("code"),
                active.code,
            )}
            {divider}
            {button(
                "ul",
                t("ui.editor.bulletedList"),
                <ListIcon size={14} />,
                () => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
                active.bullet,
            )}
            {layout === "inline"
                ? button(
                      "ol",
                      t("ui.editor.numberedList"),
                      <ListNumbersIcon size={14} />,
                      () => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
                      active.ordered,
                  )
                : null}
            {layout === "inline"
                ? button(
                      "quote",
                      t("ui.editor.quote"),
                      <QuotesIcon size={14} />,
                      () => formatBlock(blockType === "quote" ? "paragraph" : "quote"),
                      blockType === "quote",
                  )
                : null}
            {layout === "inline" ? divider : null}

            {/* The panel bar (default layout) has no link button. */}
            {layout === "inline" ? (
                <Popover
                    open={disabled ? false : linkOpen}
                    onOpenChange={(next) => {
                        setLinkOpen(next)
                        if (!next) return
                        setLinkDraft(linkUrl)
                        linkSelection.current = editor
                            .getEditorState()
                            .read(() => $getSelection()?.clone() ?? null)
                    }}
                >
                    <Tip title={t("ui.editor.link")}>
                        <PopoverTrigger asChild disabled={disabled}>
                            <Button
                                type="button"
                                variant="ghost"
                                size={iconSize}
                                aria-label={t("ui.editor.link")}
                                aria-pressed={active.link}
                                disabled={disabled}
                                onMouseDown={keepEditorSelection}
                                className={TOOL_CLASS}
                            >
                                <LinkIcon size={14} />
                            </Button>
                        </PopoverTrigger>
                    </Tip>
                    <PopoverContent side="bottom" align="center" className="p-3">
                        <div className="flex w-60 flex-col gap-2">
                            <Input
                                autoFocus
                                value={linkDraft}
                                placeholder="https://example.com"
                                onChange={(e) => setLinkDraft(e.target.value)}
                                onKeyDown={onLinkKeyDown}
                            />
                            <div className="flex items-center justify-between gap-2">
                                {active.link ? (
                                    <Button
                                        variant="destructive-ghost"
                                        size="sm"
                                        onClick={removeLink}
                                    >
                                        {<LinkBreakIcon size={13} />}
                                        {t("common.remove")}
                                    </Button>
                                ) : (
                                    <span />
                                )}
                                <Button variant="default" size="sm" onClick={applyLink}>
                                    {active.link ? t("common.update") : t("ui.editor.addLink")}
                                </Button>
                            </div>
                        </div>
                    </PopoverContent>
                </Popover>
            ) : null}

            {/* Inside a table: the row/column menu. Elsewhere: the size picker. */}
            {active.insideTable && !disabled ? (
                <DropdownMenu>
                    <Tip title={t("ui.editor.tableOptions")}>
                        <DropdownMenuTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size={layout === "default" ? "xs" : "compact"}
                                aria-label={t("ui.editor.tableOptions")}
                                onMouseDown={keepEditorSelection}
                                className={cn(TOOL_CLASS, "gap-0.5 px-1")}
                            >
                                <TableIcon size={14} />
                                <CaretDownIcon size={12} />
                            </Button>
                        </DropdownMenuTrigger>
                    </Tip>
                    <DropdownMenuContent align="start">
                        <DropdownMenuItem
                            onMouseDown={keepEditorSelection}
                            onSelect={() => runTableOp(() => $insertTableRowAtSelection(false))}
                        >
                            {t("ui.editor.insertRowAbove")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onMouseDown={keepEditorSelection}
                            onSelect={() => runTableOp(() => $insertTableRowAtSelection(true))}
                        >
                            {t("ui.editor.insertRowBelow")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onMouseDown={keepEditorSelection}
                            onSelect={() => runTableOp(() => $insertTableColumnAtSelection(false))}
                        >
                            {t("ui.editor.insertColumnLeft")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onMouseDown={keepEditorSelection}
                            onSelect={() => runTableOp(() => $insertTableColumnAtSelection(true))}
                        >
                            {t("ui.editor.insertColumnRight")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onMouseDown={keepEditorSelection}
                            onSelect={() => runTableOp(() => $deleteTableRowAtSelection())}
                        >
                            {t("ui.editor.deleteRow")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onMouseDown={keepEditorSelection}
                            onSelect={() => runTableOp(() => $deleteTableColumnAtSelection())}
                        >
                            {t("ui.editor.deleteColumn")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            variant="destructive"
                            onMouseDown={keepEditorSelection}
                            onSelect={deleteTable}
                        >
                            {t("ui.editor.deleteTable")}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : (
                <Popover open={disabled ? false : tableOpen} onOpenChange={setTableOpen}>
                    <Tip title={t("ui.editor.insertTable")}>
                        <PopoverTrigger asChild disabled={disabled}>
                            <Button
                                type="button"
                                variant="ghost"
                                size={iconSize}
                                aria-label={t("ui.editor.insertTable")}
                                disabled={disabled}
                                onMouseDown={keepEditorSelection}
                                className={TOOL_CLASS}
                            >
                                <TableIcon size={14} />
                            </Button>
                        </PopoverTrigger>
                    </Tip>
                    <PopoverContent
                        side="bottom"
                        align="center"
                        className="p-3"
                        // Leave focus in the editor.
                        onOpenAutoFocus={(e) => e.preventDefault()}
                    >
                        <TableSizePicker onPick={insertTable} />
                    </PopoverContent>
                </Popover>
            )}
        </div>
    )
}
