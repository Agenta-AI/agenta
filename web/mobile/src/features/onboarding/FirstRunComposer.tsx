import type {MutableRefObject, ReactNode} from "react"

import {ChatComposer} from "@agenta/chat/components"
import type {useComposerAttachments} from "@agenta/chat/hooks"
import type {AgentSetupSelection} from "@agenta/entities/workflow"
import type {AgentSetupStep} from "@agenta/entity-ui/onboarding"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {Button} from "@agenta/ui/ui"
import {ArrowRight, RotateCcw} from "lucide-react"

import {CONNECT_STEP_MODE} from "@/lib/connectStep"

import {FIRST_RUN_COPY} from "./copy"

/**
 * The create surface's composer: describe an agent, send, and it exists.
 *
 * `HomeTaskComposer` cannot serve this — it runs a task with an agent that ALREADY exists, and
 * with none to pick it disables itself. So this binds the same underlying `ChatComposer` to the
 * create path instead: the first submit runs the shared mint+commit core, stashes what was typed
 * as the session's pending task, and lands in the chat that sends it. From there the connect-model
 * gate takes over — on a keyless project the message parks and the strip asks for a key.
 *
 * With the connect step on (#6043), submitting opens the step instead of creating — but the step
 * renders in the screen's offer slot, NOT here. This editor stays mounted the whole time: the
 * description stays in it, editable, and the card above gates the create.
 */
export const FirstRunComposer = ({
    inputRef,
    attachments,
    step,
    creating,
    setupHeader,
    stepReady = false,
    onStepCreate,
    onTextChange,
    onResetPrompt,
    onCreate,
    onParkText,
}: {
    /** Owned by the screen: the step's card reads the live text through the same ref. */
    inputRef: MutableRefObject<RichChatInputHandle | null>
    /** Owned by the screen: staged files ride into the create alongside the text. */
    attachments: ReturnType<typeof useComposerAttachments>
    /** Owned by the screen, so the offer slot can swap the strip for the card. */
    step: AgentSetupStep
    creating: boolean
    /** The connect step, docked INSIDE the composer frame above the editor (one surface). */
    setupHeader?: ReactNode
    /** The step's create gate — enables the Create button that replaces Send. */
    stepReady?: boolean
    /** Create with the step's selection; rendered in the send button's place while step is open. */
    onStepCreate?: () => void
    /** Reports the editor's PLAIN text on every commit — the fill included, which is what lets
     * the screen baseline a template's prompt and watch for edits. */
    onTextChange?: (text: string) => void
    /** Present only while a template's prompt is edited: one tap restores the original. */
    onResetPrompt?: () => void
    /** The screen's create — shared with the setup card, so both paths run the same commit. */
    onCreate: (text: string, setup?: AgentSetupSelection) => Promise<void>
    /** Park text for the editor — `ChatComposer` clears itself on submit, before the step shows. */
    onParkText: (text: string) => void
}) => {
    const start = async (text: string) => {
        // The step is open: Enter means what the button beside it means — create, once the
        // step's required connections are made.
        if (step.draft) {
            if (stepReady && !creating) onStepCreate?.()
            return
        }
        // Connect step on (#6043): submitting opens the step rather than creating. The accounts
        // this agent will need get connected while it is still a draft.
        if (CONNECT_STEP_MODE) {
            const typed = text.trim()
            if (!typed) return
            // Only stop for the step when it has an account to ask about — and put the cleared
            // text straight back: the editor stays on screen under the card.
            if (step.open({seedMessage: typed})) {
                onParkText(typed)
                return
            }
        }
        await onCreate(text)
    }

    return (
        // One box: `ChatComposer` renders two siblings (a usually-empty rejections dock plus the
        // input), and the screen's gap-* column was paying a full gap around the invisible one —
        // the offer above the editor sat a whole extra step away.
        <div className="flex flex-col">
            <ChatComposer
                inputRef={inputRef}
                onSubmit={start}
                attachments={attachments}
                placeholder={FIRST_RUN_COPY.placeholder}
                // The step never locks the EDITOR — the prompt stays the user's to edit throughout;
                // only the Create action below is gated on the step's required connections.
                disabled={creating}
                composerDisabled={creating}
                // The connect step docks inside this frame: the step IS part of composing the
                // agent's first message, so it shares the surface instead of floating above it.
                headerExtra={setupHeader}
                onChange={onTextChange}
                // The desktop names the action instead of showing a bare send arrow: this composer
                // CREATES an agent, it does not send a message to one that exists.
                hideSendButton
                trailing={
                    <>
                        {/* Beside Create, NOT in the prefix: the footer's left corner belongs to
                            the paperclip, and Reset sitting there crowded attach out of reach. */}
                        {onResetPrompt ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={creating}
                                onClick={onResetPrompt}
                            >
                                <RotateCcw size={13} />
                                {FIRST_RUN_COPY.resetPrompt}
                            </Button>
                        ) : null}
                        {step.draft ? (
                            // The step's Create, where Send lives — gated by the connections.
                            <Button
                                size="sm"
                                disabled={!stepReady || creating}
                                onClick={() => onStepCreate?.()}
                            >
                                {creating ? FIRST_RUN_COPY.creating : FIRST_RUN_COPY.create}
                                <ArrowRight size={14} />
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                disabled={creating}
                                onClick={() => void start(inputRef.current?.getMarkdown() ?? "")}
                            >
                                {creating ? FIRST_RUN_COPY.creating : FIRST_RUN_COPY.create}
                                <ArrowRight size={14} />
                            </Button>
                        )}
                    </>
                }
            />
        </div>
    )
}
