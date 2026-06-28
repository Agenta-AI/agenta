/**
 * MarkdownToolbar
 *
 * A formatting toolbar for the rich-text Lexical editor: heading, bold, italic, lists, link, inline
 * code, and quote. It reads the editor from composer context, so it must render inside an
 * `EditorProvider` (e.g. mounted by `MarkdownEditor` above the editor). Formatting applies to the
 * rich-text (rendered) view; pass `disabled` while the editor shows raw Markdown source.
 */
import {type ReactNode, useCallback, useEffect, useState} from "react"

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
import {$getNearestNodeOfType} from "@lexical/utils"
import {
    $getSelection,
    $isRangeSelection,
    type ElementNode,
    FORMAT_TEXT_COMMAND,
    type TextFormatType,
} from "lexical"
import {
    Bold,
    Code,
    Heading2,
    Italic,
    Link as LinkIcon,
    List,
    ListOrdered,
    Quote,
} from "lucide-react"

export interface MarkdownToolbarProps {
    /** Disable the buttons (e.g. while the editor shows raw Markdown source or is read-only). */
    disabled?: boolean
}

export function MarkdownToolbar({disabled = false}: MarkdownToolbarProps) {
    const [editor] = useLexicalComposerContext()
    const [active, setActive] = useState({
        bold: false,
        italic: false,
        code: false,
        heading: false,
        quote: false,
        bullet: false,
        ordered: false,
        link: false,
    })

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
                setActive({
                    bold: selection.hasFormat("bold"),
                    italic: selection.hasFormat("italic"),
                    code: selection.hasFormat("code"),
                    heading: $isHeadingNode(block),
                    quote: $isQuoteNode(block),
                    bullet: listType === "bullet",
                    ordered: listType === "number",
                    link: $isLinkNode(anchorNode) || $isLinkNode(parent),
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
            className={[
                "flex h-7 w-7 items-center justify-center rounded border-0 bg-transparent transition-colors",
                disabled
                    ? "cursor-not-allowed text-[var(--ag-c-97A4B0,#97a4b0)] opacity-50"
                    : "cursor-pointer text-[var(--ag-c-586673,#586673)] hover:bg-[var(--ag-c-EAEFF5,#eaeff5)]",
                isActive
                    ? "bg-[var(--ag-c-EAEFF5,#eaeff5)] !text-[var(--ag-c-1677FF,#1677ff)]"
                    : "",
            ].join(" ")}
        >
            {icon}
        </button>
    )

    return (
        <div className="flex items-center gap-0.5">
            {button(
                "h",
                "Heading",
                <Heading2 size={15} />,
                () => setBlock(() => $createHeadingNode("h2")),
                active.heading,
            )}
            {button("b", "Bold", <Bold size={15} />, () => formatText("bold"), active.bold)}
            {button("i", "Italic", <Italic size={15} />, () => formatText("italic"), active.italic)}
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
            {button(
                "link",
                "Link",
                <LinkIcon size={15} />,
                // Toggle: on an existing link, dispatch null to remove it; otherwise seed a new link.
                () => editor.dispatchCommand(TOGGLE_LINK_COMMAND, active.link ? null : "https://"),
                active.link,
            )}
            {button("code", "Code", <Code size={15} />, () => formatText("code"), active.code)}
            {button(
                "quote",
                "Quote",
                <Quote size={15} />,
                () => setBlock(() => $createQuoteNode()),
                active.quote,
            )}
        </div>
    )
}
