import {useEffect, useState, type ReactNode} from "react"

import {shortcutAria} from "@agenta/shared/utils"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {Stop} from "@phosphor-icons/react"

import {Button} from "../../components/ui/button"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "../../components/ui/tooltip"
import {$isBlankMessage, submitEditorAsMarkdown, type SubmitHandler} from "../assets/submit"
import {ComposerSendButton} from "../ComposerSendButton"

interface SendButtonProps {
    onSubmit: SubmitHandler
    /** Keep enabled even with empty text (e.g. attachments are queued) — sends an empty message. */
    forceEnabled?: boolean
    disabled?: boolean
    /** Tooltip shown when a caller blocks submit. */
    disabledReason?: ReactNode
    /** A run is in flight: an empty composer shows Stop, a draft shows Send (which queues). */
    streaming?: boolean
    stopping?: boolean
    /** Request a durable stop — required for the `streaming` state. */
    onStop?: () => void
    /** Additional submit choices shown beside Stop while a run is active. */
    busyActions?: {label: string; onSubmit: SubmitHandler}[]
    /** The send is in flight; see ComposerSendButton. */
    sending?: boolean
}

/** Circular send button. Mirrors the Cmd/Ctrl+Enter path via the shared submit helper.
 * During a run it is Stop when the composer is empty and Send when it holds a draft. */
export function SendButton({
    onSubmit,
    forceEnabled,
    disabled,
    disabledReason,
    streaming,
    stopping,
    onStop,
    busyActions,
    sending,
}: SendButtonProps) {
    const [editor] = useLexicalComposerContext()
    const [empty, setEmpty] = useState(true)

    useEffect(() => {
        return editor.registerUpdateListener(({editorState}) => {
            editorState.read(() => setEmpty($isBlankMessage()))
        })
    }, [editor])

    const handleClick = () => {
        if (disabled) return
        submitEditorAsMarkdown(editor, onSubmit, forceEnabled)
    }

    const hasDraft = !empty || !!forceEnabled
    if (streaming || busyActions?.length) {
        // A spinning ring (stream in progress) around a Stop square — one affordance that both
        // signals progress and stops the run on click. Two-layer ring: a faint neutral track under
        // a thin, muted-primary arc, so the accent reads as a calm progress cue rather than a loud
        // full-saturation halo; the Stop glyph stays neutral so the accent isn't doubled up.
        return (
            <span className="inline-flex items-center gap-1">
                {busyActions?.map((action) => (
                    <Button
                        key={action.label}
                        size="sm"
                        variant="ghost"
                        disabled={disabled || (empty && !forceEnabled)}
                        onClick={() =>
                            submitEditorAsMarkdown(editor, action.onSubmit, forceEnabled)
                        }
                    >
                        {action.label}
                    </Button>
                ))}
                {streaming && !hasDraft ? (
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
                            size="icon"
                            variant="ghost"
                            className="rounded-control-round"
                            aria-label={stopping ? "Stopping" : "Stop"}
                            aria-keyshortcuts={shortcutAria("run.stop")}
                            onClick={onStop}
                            disabled={stopping}
                        >
                            <Stop
                                size={13}
                                weight="fill"
                                className="text-[var(--ag-colorTextSecondary)]"
                            />
                        </Button>
                    </span>
                ) : null}
                {hasDraft ? (
                    <ComposerSendButton
                        onClick={handleClick}
                        disabled={disabled}
                        sending={sending}
                    />
                ) : null}
            </span>
        )
    }

    const sendDisabled = disabled || (empty && !forceEnabled)
    const button = (
        <ComposerSendButton onClick={handleClick} disabled={sendDisabled} sending={sending} />
    )
    if (!sendDisabled || !disabledReason) return button

    // The span keeps the tooltip reachable: a disabled button emits no pointer events.
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className="inline-flex">{button}</span>
                </TooltipTrigger>
                <TooltipContent>{disabledReason}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
