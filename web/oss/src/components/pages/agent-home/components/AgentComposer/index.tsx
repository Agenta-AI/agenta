import {type RefObject} from "react"

import {RichChatInput, type RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {Button, Tooltip} from "antd"
import {ArrowRight, Code2, Paperclip} from "lucide-react"

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
            className="!rounded-[10px] !border-[var(--ag-composer-border)] !bg-[var(--ag-colorBgContainer)] !shadow-[0_1px_3px_0_rgb(0_0_0_/_0.1),0_1px_2px_-1px_rgb(0_0_0_/_0.1)] focus-within:!border-[var(--ag-composer-focus)]"
            prefix={
                <div className="flex items-center gap-2 text-[var(--ag-colorTextTertiary)]">
                    <Tooltip title="Attach files coming soon">
                        <Paperclip size={15} className="cursor-not-allowed" />
                    </Tooltip>
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
                        onClick={onCreate}
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
