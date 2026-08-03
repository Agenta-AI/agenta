import {useCallback, useMemo, useRef, useState} from "react"

import {RichChatInput, type RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {PlusIcon, RobotIcon} from "@phosphor-icons/react"
import {Divider, Select} from "antd"
import {useAtomValue} from "jotai"

import {useStartAgentSession} from "@/oss/components/AgentChatSlice/hooks/useStartAgentSession"
import {agentsWorkflowsAtom} from "@/oss/components/pages/agents/store"

/**
 * Home's primary action: describe a task, pick the agent to run it, send.
 *
 * The picker rides the composer's `prefix` (left), leaving the composer's own send button where
 * it always is — the send affordance is the one the rest of the app teaches, and a bespoke "Start"
 * button beside it would be a second way to do the same thing.
 *
 * Creating an agent lives in the picker's footer: it happens once, unlike starting a task.
 */
const HomeTaskComposer = ({onCreateAgent}: {onCreateAgent: () => void}) => {
    const composerRef = useRef<RichChatInputHandle>(null)
    const agents = useAtomValue(agentsWorkflowsAtom)
    const startSession = useStartAgentSession()
    const [agentId, setAgentId] = useState<string | null>(null)

    // Default to the most recently touched agent — the one you're most likely to want next.
    const effectiveAgentId = agentId ?? agents[0]?.workflowId ?? null

    const options = useMemo(
        () => agents.map((agent) => ({value: agent.workflowId, label: agent.name})),
        [agents],
    )

    const handleSubmit = useCallback(
        (markdown: string) => {
            if (!effectiveAgentId) return
            startSession({appId: effectiveAgentId, message: markdown})
        },
        [effectiveAgentId, startSession],
    )

    return (
        <RichChatInput
            ref={composerRef}
            onSubmit={handleSubmit}
            placeholder="Describe the task, or start the conversation…"
            size="comfortable"
            minHeightClassName="min-h-24"
            textSizeClassName="text-sm"
            sendDisabled={!effectiveAgentId}
            sendDisabledReason="Pick an agent first"
            prefix={
                <Select
                    value={effectiveAgentId}
                    onChange={setAgentId}
                    options={options}
                    placeholder="Select an agent"
                    variant="borderless"
                    className="min-w-40"
                    suffixIcon={<RobotIcon size={14} />}
                    popupRender={(menu) => (
                        <>
                            {menu}
                            <Divider className="my-1" />
                            <button
                                type="button"
                                onClick={onCreateAgent}
                                className="flex w-full cursor-pointer items-center gap-2 border-0 bg-colorFillQuaternary px-3 py-2 text-xs text-colorPrimary"
                            >
                                <PlusIcon size={14} />
                                New agent
                            </button>
                        </>
                    )}
                />
            }
        />
    )
}

export default HomeTaskComposer
