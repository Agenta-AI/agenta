import {type RefObject} from "react"

import {RichChatInput, type RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {Button, Tooltip} from "antd"
import {ArrowRight, Bold, Code2, Italic, Paperclip} from "lucide-react"

import {COMPOSER, HERO} from "../../assets/constants"

interface AgentComposerProps {
    /** Composer handle owned by the page (read/prefill markdown). */
    composerRef: RefObject<RichChatInputHandle | null>
    /** Create the agent from the current text (Build-in-UI). */
    onCreate: () => void
    /** Open the IDE-handoff modal with the current text (Continue-in-IDE). */
    onContinueInIde: () => void
}

/**
 * Home hero composer. Reuses the agent-playground RichChatInput; the footer holds two actions —
 * `Continue in IDE` (opens the IDE-handoff modal) on the left and the primary `Create agent` on the
 * right. Mirrors the playground onboarding composer's two-button layout.
 */
const AgentComposer = ({composerRef, onCreate, onContinueInIde}: AgentComposerProps) => {
    return (
        <RichChatInput
            ref={composerRef}
            onSubmit={() => onCreate()}
            placeholder={HERO.placeholder}
            hideSendButton
            hideShortcutHints
            submitOnEnter={false}
            minHeightClassName="min-h-[112px]"
            textSizeClassName="text-sm"
            className="!bg-[var(--ag-colorFillTertiary)]"
            prefix={
                <div className="flex items-center gap-2 text-[var(--ag-colorTextTertiary)]">
                    <Tooltip title="Attach files coming soon">
                        <Paperclip size={15} className="cursor-not-allowed" />
                    </Tooltip>
                    <Bold size={15} />
                    <Italic size={15} />
                </div>
            }
            trailing={
                <div className="flex items-center gap-2">
                    <Button icon={<Code2 size={14} />} onClick={onContinueInIde}>
                        {COMPOSER.tabIde}
                    </Button>
                    <Button
                        type="primary"
                        icon={<ArrowRight size={14} />}
                        iconPosition="end"
                        onClick={() => onCreate()}
                        className="!shadow-none"
                    >
                        {COMPOSER.createAgent}
                    </Button>
                </div>
            }
        />
    )
}

export default AgentComposer
