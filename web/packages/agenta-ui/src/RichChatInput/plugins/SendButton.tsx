import {useEffect, useState} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {Stop} from "@phosphor-icons/react"
import {Button} from "antd"

import {$isBlankMessage, submitEditorAsMarkdown} from "../assets/submit"
import {ComposerSendButton} from "../ComposerSendButton"

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
            editorState.read(() => setEmpty($isBlankMessage()))
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
        // A spinning ring (stream in progress) around a Stop square — one affordance that both
        // signals progress and stops the run on click. Two-layer ring: a faint neutral track under
        // a thin, muted-primary arc, so the accent reads as a calm progress cue rather than a loud
        // full-saturation halo; the Stop glyph stays neutral so the accent isn't doubled up.
        return (
            <span className="relative inline-flex">
                <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-full border-[1.5px] border-solid border-[var(--ag-colorFillSecondary)]"
                />
                <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 animate-spin rounded-full border-[1.5px] border-solid border-transparent"
                    style={{
                        borderTopColor:
                            "color-mix(in srgb, var(--ag-colorPrimary) 60%, var(--ag-colorBgContainer))",
                    }}
                />
                <Button
                    type="text"
                    shape="circle"
                    aria-label="Stop"
                    icon={
                        <Stop
                            size={13}
                            weight="fill"
                            className="text-[var(--ag-colorTextSecondary)]"
                        />
                    }
                    onClick={onStop}
                />
            </span>
        )
    }

    const sendDisabled = disabled || (empty && !forceEnabled)
    return <ComposerSendButton onClick={handleClick} disabled={sendDisabled} />
}
