import {type ReactNode, type RefObject} from "react"

import {RichChatInput, type RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {ArrowCounterClockwise} from "@phosphor-icons/react"
import {Button} from "antd"

import {STRIP_COPY} from "../assets/constants"

import AgentIntentActions from "./AgentIntentActions"

interface StripComposerProps {
    /** Composer handle owned by the page (read/prefill markdown). */
    composerRef: RefObject<RichChatInputHandle | null>
    /**
     * Create the agent. Enter passes the submitted markdown (the editor clears itself on
     * submit, so a ref read after the fact would see an empty composer); the button passes
     * nothing and the caller reads the ref.
     */
    onCreate: (markdown?: string) => void
    /** Chip-docking border/radius classes from `useTemplateProvenance`. */
    composerClassName: string
    /** Forwarded to `RichChatInput`'s `onChange` — lets provenance notice the text going empty. */
    onTextChange?: (text: string) => void
    /** Create is in flight — spins the primary button and swaps its label to "Creating agent". */
    loading?: boolean
    /**
     * Docked INSIDE the input frame, above the editor — the connect step's card, which belongs
     * to the message being composed rather than floating beside it (mobile parity).
     */
    header?: ReactNode
    /** The connect step's gate: disables Create (never the editor). */
    createDisabled?: boolean
    /** Present only while a template's prompt is edited: one click restores the original. */
    onResetPrompt?: () => void
}

/**
 * The home hero's "describe an agent" composer. Deliberately the SAME `RichChatInput`
 * configuration as the playground onboarding composer (AgentConversation) — Enter creates the
 * agent, the shortcut hints show, and the trailing actions are the shared `AgentIntentActions` —
 * so the two surfaces can't drift apart. Only hero-scale presentation differs (taller min-height,
 * `text-sm`, and the provenance-chip docking classes).
 */
const StripComposer = ({
    composerRef,
    onCreate,
    composerClassName,
    onTextChange,
    loading,
    header,
    createDisabled,
    onResetPrompt,
}: StripComposerProps) => {
    return (
        <RichChatInput
            ref={composerRef}
            onSubmit={(markdown) => onCreate(markdown)}
            onChange={onTextChange}
            placeholder={STRIP_COPY.describeAgentPlaceholder}
            hideSendButton
            size="comfortable"
            minHeightClassName="min-h-24"
            textSizeClassName="text-sm"
            className={composerClassName}
            header={header}
            trailing={
                <div className="flex items-center gap-2">
                    {onResetPrompt ? (
                        <Button
                            type="text"
                            icon={<ArrowCounterClockwise size={13} />}
                            onClick={onResetPrompt}
                            disabled={loading}
                        >
                            {STRIP_COPY.resetPrompt}
                        </Button>
                    ) : null}
                    <AgentIntentActions
                        onCreate={() => onCreate()}
                        loading={loading}
                        disabled={createDisabled}
                    />
                </div>
            }
        />
    )
}

export default StripComposer
