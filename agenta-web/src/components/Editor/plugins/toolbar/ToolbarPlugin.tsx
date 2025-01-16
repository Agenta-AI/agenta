import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {mergeRegister} from "@lexical/utils"
import {Bold, Italic, Underline, Code, AlignLeft, AlignCenter, AlignRight} from "lucide-react"
import {
    $getSelection,
    $isRangeSelection,
    FORMAT_TEXT_COMMAND,
    FORMAT_ELEMENT_COMMAND,
} from "lexical"
import {useCallback, useEffect, useState} from "react"

export function ToolbarPlugin(): JSX.Element {
    const [editor] = useLexicalComposerContext()
    const [isBold, setIsBold] = useState(false)
    const [isItalic, setIsItalic] = useState(false)
    const [isUnderline, setIsUnderline] = useState(false)
    const [isCode, setIsCode] = useState(false)

    const updateToolbar = useCallback(() => {
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
                    updateToolbar()
                })
            }),
        )
    }, [editor, updateToolbar])

    const toolbarButton = "p-2 rounded hover:bg-gray-100 transition-colors"
    const activeClass = "bg-gray-200"

    return (
        <div className="flex items-center gap-1 p-2 border-b">
            <button
                className={`${toolbarButton} ${isBold ? activeClass : ""}`}
                onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
            >
                <Bold size={18} />
            </button>
            <button
                className={`${toolbarButton} ${isItalic ? activeClass : ""}`}
                onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}
            >
                <Italic size={18} />
            </button>
            <button
                className={`${toolbarButton} ${isUnderline ? activeClass : ""}`}
                onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline")}
            >
                <Underline size={18} />
            </button>
            <button
                className={`${toolbarButton} ${isCode ? activeClass : ""}`}
                onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code")}
            >
                <Code size={18} />
            </button>
            <div className="w-px h-6 bg-gray-200 mx-2" />
            <button
                className={toolbarButton}
                onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "left")}
            >
                <AlignLeft size={18} />
            </button>
            <button
                className={toolbarButton}
                onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "center")}
            >
                <AlignCenter size={18} />
            </button>
            <button
                className={toolbarButton}
                onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "right")}
            >
                <AlignRight size={18} />
            </button>
        </div>
    )
}
