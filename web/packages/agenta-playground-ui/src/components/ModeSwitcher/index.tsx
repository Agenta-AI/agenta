import {memo, useState} from "react"

import {
    playgroundCapabilityModeAtom,
    playgroundHasConversationAtom,
    switchPlaygroundModeAtom,
    type PlaygroundMode,
} from "@agenta/playground"
import {executionController} from "@agenta/playground"
import {EnhancedModal} from "@agenta/ui/components/modal"
import {ChatCircle, Rows, ArrowsLeftRight} from "@phosphor-icons/react"
import {Button, Segmented, Tooltip, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

/**
 * Segmented `Chat | Completion` control that switches the playground behavior
 * for a chat-capable app. Renders nothing for pure completion apps (they
 * cannot run conversations). Disabled in comparison view.
 *
 * Chat → completion with an existing conversation asks for confirmation
 * first; an empty chat switches silently. Design doc:
 * docs/design/playground-mode-switch/.
 */
interface ModeSwitcherProps {
    /** Comparison view disables switching (mode is global; one variant only). */
    disabled?: boolean
}

const ModeSwitcher = ({disabled = false}: ModeSwitcherProps) => {
    const capability = useAtomValue(playgroundCapabilityModeAtom)
    const isChat = useAtomValue(executionController.selectors.isChatMode) ?? false
    const hasConversation = useAtomValue(playgroundHasConversationAtom)
    const switchMode = useSetAtom(switchPlaygroundModeAtom)

    const [confirmOpen, setConfirmOpen] = useState(false)

    // Only chat-capable apps can switch; completion apps stay as they are.
    if (capability !== "chat") return null

    const value: PlaygroundMode = isChat ? "chat" : "completion"

    const handleChange = (next: PlaygroundMode) => {
        if (next === value) return
        // Reshaping only happens chat → completion, and only a non-empty
        // conversation needs the heads-up.
        if (next === "completion" && hasConversation) {
            setConfirmOpen(true)
            return
        }
        switchMode(next)
    }

    const confirmSwitch = () => {
        setConfirmOpen(false)
        switchMode("completion")
    }

    const control = (
        <Segmented<PlaygroundMode>
            size="small"
            value={value}
            disabled={disabled}
            onChange={handleChange}
            options={[
                {value: "chat", label: "Chat", icon: <ChatCircle size={13} />},
                {value: "completion", label: "Completion", icon: <Rows size={13} />},
            ]}
        />
    )

    return (
        <>
            {disabled ? (
                <Tooltip title="Switching modes is available outside compare view">
                    {control}
                </Tooltip>
            ) : (
                control
            )}

            <EnhancedModal
                open={confirmOpen}
                width={480}
                title={
                    <span className="text-[15px] font-semibold text-[var(--ag-c-1c2c3d)]">
                        Switch to Completion?
                    </span>
                }
                onCancel={() => setConfirmOpen(false)}
                footer={[
                    <Button key="cancel" onClick={() => setConfirmOpen(false)}>
                        Cancel
                    </Button>,
                    <Button
                        key="switch"
                        type="primary"
                        icon={<ArrowsLeftRight size={14} />}
                        onClick={confirmSwitch}
                    >
                        Switch
                    </Button>,
                ]}
            >
                <div className="flex flex-col gap-1 text-[13px]">
                    <Typography.Text className="!text-[var(--ag-c-586673)]">
                        The conversation becomes a constant <code>messages</code> column. Run
                        regenerates only the final answer.
                    </Typography.Text>
                    <Typography.Text className="!text-[var(--ag-c-758391)]">
                        Nothing is deleted. Switch back anytime.
                    </Typography.Text>
                </div>
            </EnhancedModal>
        </>
    )
}

export default memo(ModeSwitcher)
