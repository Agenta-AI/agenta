import {useEffect, useState} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {ArrowUp} from "@phosphor-icons/react"
import {Button} from "antd"
import {$getRoot} from "lexical"

import {submitEditorAsMarkdown} from "../assets/submit"

interface SendButtonProps {
    onSubmit: (markdown: string) => void
    /** Keep enabled even with empty text (e.g. attachments are queued) — sends an empty message. */
    forceEnabled?: boolean
    disabled?: boolean
}

/** Circular send button. Mirrors the Cmd/Ctrl+Enter path via the shared submit helper. */
export function SendButton({onSubmit, forceEnabled, disabled}: SendButtonProps) {
    const [editor] = useLexicalComposerContext()
    const [empty, setEmpty] = useState(true)

    useEffect(() => {
        return editor.registerUpdateListener(({editorState}) => {
            editorState.read(() => setEmpty($getRoot().getTextContentSize() === 0))
        })
    }, [editor])

    const handleClick = () => {
        if (empty) {
            if (forceEnabled) onSubmit("")
            return
        }
        submitEditorAsMarkdown(editor, onSubmit)
    }

    return (
        <Button
            type="primary"
            shape="circle"
            aria-label="Send"
            icon={<ArrowUp size={16} weight="bold" />}
            disabled={disabled || (empty && !forceEnabled)}
            onClick={handleClick}
        />
    )
}
