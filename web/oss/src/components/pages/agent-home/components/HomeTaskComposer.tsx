import {useCallback, useMemo, useRef, useState} from "react"

import {RichChatInput, type RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {RobotIcon} from "@phosphor-icons/react"
import {Select} from "antd"
import {useAtomValue} from "jotai"

import {useStartAgentSession} from "@/oss/components/AgentChatSlice/hooks/useStartAgentSession"
import {
    SeedAttachButton,
    SeedAttachmentChips,
    useSeedAttachments,
} from "@/oss/components/pages/agent-home/components/SeedAttachments"
import {agentsWorkflowsAtom} from "@/oss/components/pages/agents/store"

/**
 * Home's primary action: describe a task, pick the agent to run it, send.
 *
 * The picker rides the composer's `prefix` (left), leaving the composer's own send button where
 * it always is — the send affordance is the one the rest of the app teaches, and a bespoke "Start"
 * button beside it would be a second way to do the same thing.
 *
 * This composer does exactly ONE thing: run a task with an agent that exists. "Create new agent"
 * used to sit in this picker as a mode, which meant the only entry point to creating an agent was
 * hidden inside a dropdown, and send did two different things depending on a selection you
 * couldn't see. Creating an agent is its own surface now — see the `?new=1` branch in StripHome.
 */
const HomeTaskComposer = () => {
    const composerRef = useRef<RichChatInputHandle>(null)
    const agents = useAtomValue(agentsWorkflowsAtom)
    const startSession = useStartAgentSession()
    const [agentId, setAgentId] = useState<string | null>(null)
    const [pickerOpen, setPickerOpen] = useState(false)
    const attachments = useSeedAttachments()

    // Default to the most recently touched agent — the one you're most likely to want next.
    const effectiveAgentId = agentId ?? agents[0]?.workflowId ?? null

    const options = useMemo(
        () => agents.map((agent) => ({value: agent.workflowId, label: agent.name})),
        [agents],
    )

    const handleSubmit = useCallback(
        (markdown: string) => {
            if (!effectiveAgentId) return
            startSession({appId: effectiveAgentId, message: markdown, files: attachments.files})
            attachments.clear()
        },
        [effectiveAgentId, startSession, attachments],
    )

    return (
        <RichChatInput
            ref={composerRef}
            onSubmit={handleSubmit}
            size="comfortable"
            minHeightClassName="min-h-24"
            textSizeClassName="text-sm"
            sendForceEnabled={attachments.files.length > 0}
            header={
                <SeedAttachmentChips files={attachments.files} onChange={attachments.setFiles} />
            }
            sendDisabled={!effectiveAgentId}
            sendDisabledReason={!effectiveAgentId ? "Pick an agent first" : undefined}
            placeholder="Describe the task, or start the conversation…"
            prefix={
                <Select
                    value={effectiveAgentId ?? undefined}
                    onChange={setAgentId}
                    open={pickerOpen}
                    onOpenChange={setPickerOpen}
                    options={options}
                    labelRender={({label}) => (
                        <span className="inline-flex items-center gap-1.5">
                            <RobotIcon size={14} className="text-colorTextTertiary" />
                            {label}
                        </span>
                    )}
                    placeholder="Select an agent"
                    variant="borderless"
                    className="min-w-40"
                />
            }
            trailing={
                attachments.enabled ? (
                    <SeedAttachButton files={attachments.files} onChange={attachments.setFiles} />
                ) : null
            }
        />
    )
}

export default HomeTaskComposer
