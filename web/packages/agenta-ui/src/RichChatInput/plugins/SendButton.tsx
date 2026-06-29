import {useEffect, useState} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {ArrowUp, Stop} from "@phosphor-icons/react"
import {Button} from "antd"
import {$getRoot} from "lexical"

import {submitEditorAsMarkdown} from "../assets/submit"

interface SendButtonProps {
    onSubmit: (markdown: string) => void
    /** Keep enabled even with empty text (e.g. attachments are queued) — sends an empty message. */
    forceEnabled?: boolean
    disabled?: boolean
    /** When true, the button becomes a Stop button that aborts the in-flight stream. */
    streaming?: boolean
    /** Abort the in-flight stream — required for the `streaming` state. */
    onStop?: () => void
}

/** Circular send button. Mirrors the Cmd/Ctrl+Enter path via the shared submit helper.
 * While a stream is in flight it morphs into a Stop button (single affordance, no extra
 * stop control alongside it). */
export function SendButton({onSubmit, forceEnabled, disabled, streaming, onStop}: SendButtonProps) {
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

    if (streaming) {
        return (
            <Button
                type="primary"
                shape="circle"
                aria-label="Stop"
                icon={<Stop size={14} weight="fill" />}
                onClick={onStop}
            />
        )
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
