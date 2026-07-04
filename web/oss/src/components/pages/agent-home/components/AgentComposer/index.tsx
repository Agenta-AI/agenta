import {useState, type RefObject} from "react"

import {RichChatInput, type RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {Button, Segmented, Tooltip} from "antd"
import {ArrowRight, Bold, Code2, Copy, Italic, Paperclip, WandSparkles} from "lucide-react"

import {COMPOSER, HERO, IDE_INSTALL_COMMAND} from "../../assets/constants"

type ComposerMode = "ui" | "ide"

interface AgentComposerProps {
    /** Composer handle owned by the page (read/prefill markdown). */
    composerRef: RefObject<RichChatInputHandle | null>
    /** Create the agent from the current text (Build-in-UI). */
    onCreate: () => void
    /** Copy the install command + prompt (Continue-in-IDE). */
    onContinueInIde: () => void
}

/**
 * Home hero composer. Reuses the agent-playground RichChatInput; a segmented control switches
 * between Build-in-UI (Create agent) and Continue-in-IDE (install snippet + Copy prompt).
 */
const AgentComposer = ({composerRef, onCreate, onContinueInIde}: AgentComposerProps) => {
    const [mode, setMode] = useState<ComposerMode>("ui")
    const isIde = mode === "ide"
    const primary = isIde ? onContinueInIde : onCreate

    return (
        <div className="flex flex-col gap-3">
            <Segmented<ComposerMode>
                value={mode}
                onChange={setMode}
                className="self-start"
                options={[
                    {
                        value: "ui",
                        label: (
                            <span className="inline-flex items-center gap-1.5">
                                <WandSparkles size={14} />
                                {COMPOSER.tabUi}
                            </span>
                        ),
                    },
                    {
                        value: "ide",
                        label: (
                            <span className="inline-flex items-center gap-1.5">
                                <Code2 size={14} />
                                {COMPOSER.tabIde}
                            </span>
                        ),
                    },
                ]}
            />

            <RichChatInput
                ref={composerRef}
                onSubmit={() => primary()}
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
                header={
                    isIde ? (
                        <div className="mx-3 mt-3 flex items-center justify-between gap-2 rounded-md bg-[var(--ag-colorFillTertiary)] px-2.5 py-1.5">
                            <span className="font-mono text-[11px] text-[var(--ag-colorTextSecondary)]">
                                $ {IDE_INSTALL_COMMAND}
                            </span>
                            <span className="text-[10px] text-[var(--ag-colorTextTertiary)]">
                                {COMPOSER.installHint}
                            </span>
                        </div>
                    ) : undefined
                }
                trailing={
                    <Button
                        type="primary"
                        onClick={primary}
                        icon={isIde ? <Copy size={14} /> : <ArrowRight size={14} />}
                        iconPosition={isIde ? "start" : "end"}
                        className="!shadow-none"
                    >
                        {isIde ? COMPOSER.copyPrompt : COMPOSER.createAgent}
                    </Button>
                }
            />
        </div>
    )
}

export default AgentComposer
