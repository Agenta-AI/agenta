import {useCallback, useMemo, useRef, useState} from "react"

import {RichChatInput, type RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {PlusIcon, RobotIcon} from "@phosphor-icons/react"
import {Button, Divider, Select} from "antd"
import {useAtomValue} from "jotai"

import {useStartAgentSession} from "@/oss/components/AgentChatSlice/hooks/useStartAgentSession"
import {agentsWorkflowsAtom} from "@/oss/components/pages/agents/store"

/**
 * Home's primary action: describe a task, pick the agent to do it, start.
 *
 * This is the thing done every day — creating an agent happens once, so it lives inside the
 * picker's footer rather than competing as a second top-level button.
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

    const handleStart = useCallback(
        (markdown?: string) => {
            const message = markdown ?? composerRef.current?.getMarkdown() ?? ""
            if (!effectiveAgentId) return
            startSession({appId: effectiveAgentId, message})
        },
        [effectiveAgentId, startSession],
    )

    return (
        <RichChatInput
            ref={composerRef}
            onSubmit={(markdown) => handleStart(markdown)}
            placeholder="Describe the task, or start the conversation…"
            hideSendButton
            size="comfortable"
            minHeightClassName="min-h-24"
            textSizeClassName="text-sm"
            trailing={
                <div className="flex w-full items-center justify-between gap-2">
                    <Select
                        value={effectiveAgentId}
                        onChange={setAgentId}
                        options={options}
                        placeholder="Select an agent"
                        className="w-56"
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
                    <Button
                        type="primary"
                        disabled={!effectiveAgentId}
                        onClick={() => handleStart()}
                    >
                        Start
                    </Button>
                </div>
            }
        />
    )
}

export default HomeTaskComposer
