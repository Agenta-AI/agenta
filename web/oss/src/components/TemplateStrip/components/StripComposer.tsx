import {type RefObject} from "react"

import {RichChatInput, type RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {Button, Tooltip} from "antd"
import {ArrowLeftRight, ArrowRight, Paperclip} from "lucide-react"

import {HERO, COMPOSER} from "@/oss/components/pages/agent-home/assets/constants"

import {STRIP_COPY} from "../assets/constants"

interface StripComposerProps {
    /** Composer handle owned by the page (read/prefill markdown). */
    composerRef: RefObject<RichChatInputHandle | null>
    /** Create the agent from the current text (Build-in-UI). */
    onCreate: () => void
    /** Copy the coding-agent install command + current text to the clipboard. */
    onCodingAgentCopy: () => void
    /** Chip-docking border/radius classes from `useTemplateProvenance`. */
    composerClassName: string
}

/**
 * Strip-era home composer. Renders `RichChatInput` directly (no shared `AgentComposer`): the
 * trailing actions are `Use my coding agent` (clipboard handoff) and the primary `Create agent`,
 * and the wrapper classes dock flush against the provenance chip's squared top-left corner.
 */
const StripComposer = ({
    composerRef,
    onCreate,
    onCodingAgentCopy,
    composerClassName,
}: StripComposerProps) => {
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
            className={`!bg-[var(--ag-colorBgContainer)] !shadow-[0_1px_3px_0_rgb(0_0_0_/_0.1),0_1px_2px_-1px_rgb(0_0_0_/_0.1)] ${composerClassName}`}
            prefix={
                <div className="flex items-center gap-2 text-[var(--ag-colorTextTertiary)]">
                    <Tooltip title="Attach files coming soon">
                        <Paperclip size={15} className="cursor-not-allowed" />
                    </Tooltip>
                </div>
            }
            trailing={
                <div className="flex items-center gap-2">
                    <Button icon={<ArrowLeftRight size={14} />} onClick={onCodingAgentCopy}>
                        {STRIP_COPY.useCodingAgent}
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

export default StripComposer
