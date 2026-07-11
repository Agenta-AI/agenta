import {type RefObject} from "react"

import {RichChatInput, type RichChatInputHandle} from "@agenta/ui/rich-chat-input"

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
    /** Copy the coding-agent install command + current text to the clipboard. */
    onCodingAgentCopy: () => void
    /** Chip-docking border/radius classes from `useTemplateProvenance`. */
    composerClassName: string
    /** Forwarded to `RichChatInput`'s `onChange` — lets provenance notice the text going empty. */
    onTextChange?: (text: string) => void
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
    onCodingAgentCopy,
    composerClassName,
    onTextChange,
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
            trailing={
                <AgentIntentActions
                    onCreate={() => onCreate()}
                    onCodingAgentCopy={onCodingAgentCopy}
                />
            }
        />
    )
}

export default StripComposer
