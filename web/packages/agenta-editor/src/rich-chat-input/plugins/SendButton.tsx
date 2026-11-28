import {useEffect, useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import uiChatInputCatalog from "@agenta/i18n/catalogs/ui.chatInput"
import {shortcutAria} from "@agenta/shared/utils"
import {Button} from "@agenta/ui/ui"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {Stop} from "@phosphor-icons/react"

import {$isBlankMessage, submitEditorAsMarkdown, type SubmitHandler} from "../assets/submit"
import {ComposerSendButton} from "../ComposerSendButton"
import type {ComposerSurface} from "../RichChatInput"

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
    /** The composer's look; `canvas` draws the round 28 px buttons. */
    surface?: ComposerSurface
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
    surface,
}: SendButtonProps) {
    const t = useT(uiChatInputCatalog)
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
        // A Stop square while the run goes on; the transcript shows the progress.
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
                    // Send becomes Stop while the agent runs (MICRO-03): the same kit button,
                    // no spinning ring around it (MOTION-02).
                    <Button
                        size={surface === "canvas" ? "icon-sm" : "icon"}
                        variant="outline"
                        aria-label={stopping ? t("ui.chatInput.stopping") : t("ui.chatInput.stop")}
                        aria-keyshortcuts={shortcutAria("run.stop")}
                        onClick={onStop}
                        disabled={stopping}
                    >
                        <Stop size={14} weight="fill" className="text-muted-foreground" />
                    </Button>
                ) : null}
                {hasDraft ? (
                    <ComposerSendButton
                        onClick={handleClick}
                        disabled={disabled}
                        sending={sending}
                        surface={surface}
                    />
                ) : null}
            </span>
        )
    }

    const sendDisabled = disabled || (empty && !forceEnabled)
    const button = (
        <ComposerSendButton
            onClick={handleClick}
            disabled={sendDisabled}
            blocked={disabled}
            sending={sending}
            surface={surface}
        />
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
