import {useCallback, useEffect, useState, JSX} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {mergeRegister} from "@lexical/utils"
import {
    $getSelection,
    $isRangeSelection,
    FORMAT_TEXT_COMMAND,
    FORMAT_ELEMENT_COMMAND,
} from "lexical"
import {CodeIcon, TextAlignCenterIcon, TextAlignLeftIcon, TextAlignRightIcon, TextBIcon, TextItalicIcon, TextUnderlineIcon} from "@phosphor-icons/react"

export function ToolbarPlugin(): JSX.Element {
    const [editor] = useLexicalComposerContext()
    const [isBold, setIsBold] = useState(false)
    const [isItalic, setIsItalic] = useState(false)
    const [isUnderline, setIsUnderline] = useState(false)
    const [isCode, setIsCode] = useState(false)

    const $updateToolbar = useCallback(() => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
            setIsBold(selection.hasFormat("bold"))
            setIsItalic(selection.hasFormat("italic"))
            setIsUnderline(selection.hasFormat("underline"))
            setIsCode(selection.hasFormat("code"))
        }
    }, [])

    useEffect(() => {
        return mergeRegister(
            editor.registerUpdateListener(({editorState}) => {
                editorState.read(() => {
                    $updateToolbar()
                })
            }),
        )
    }, [editor, $updateToolbar])

    const toolbarButton = "p-2 rounded hover:bg-accent transition-colors"
    const activeClass = "bg-secondary"

    return (
        <div className="flex items-center gap-1 p-2 border-0 border-b border-solid">
            <button
                className={`${toolbarButton} ${isBold ? activeClass : ""}`}
                onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
            >
                <TextBIcon size={18} />
            </button>
            <button
                className={`${toolbarButton} ${isItalic ? activeClass : ""}`}
                onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}
            >
                <TextItalicIcon size={18} />
            </button>
            <button
                className={`${toolbarButton} ${isUnderline ? activeClass : ""}`}
                onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline")}
            >
                <TextUnderlineIcon size={18} />
            </button>
            <button
                className={`${toolbarButton} ${isCode ? activeClass : ""}`}
                onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code")}
            >
                <CodeIcon size={18} />
            </button>
            <div className="w-px h-6 bg-border-muted mx-2" />
            <button
                className={toolbarButton}
                onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "left")}
            >
                <TextAlignLeftIcon size={18} />
            </button>
            <button
                className={toolbarButton}
                onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "center")}
            >
                <TextAlignCenterIcon size={18} />
            </button>
            <button
                className={toolbarButton}
                onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "right")}
            >
                <TextAlignRightIcon size={18} />
            </button>
        </div>
    )
}
