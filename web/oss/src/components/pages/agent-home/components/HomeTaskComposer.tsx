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
 * "Create new agent" in the picker is a MODE, not an action: it says the task you're about to
 * describe belongs to an agent that doesn't exist yet, and send creates it from what you typed —
 * the same flow onboarding runs. Creating one the moment you click it produced an unnamed agent
 * and sent nothing, which read as broken.
 *
 * The mode renders as an icon + accented verb rather than a bare name, because an agent may well
 * BE called "New agent": with both rendered as plain text you couldn't tell whether send would
 * resume that agent or mint another one.
 */
const NEW_AGENT = "__new_agent__"
const NEW_AGENT_LABEL = "Create new agent"

const HomeTaskComposer = ({
    onCreateAgent,
    creating = false,
}: {
    /** Create an agent from this description and open it, seeded — the onboarding flow. */
    onCreateAgent: (markdown: string) => void
    creating?: boolean
}) => {
    const composerRef = useRef<RichChatInputHandle>(null)
    const agents = useAtomValue(agentsWorkflowsAtom)
    const startSession = useStartAgentSession()
    const [agentId, setAgentId] = useState<string | null>(null)
    const [pickerOpen, setPickerOpen] = useState(false)

    // Default to the most recently touched agent — the one you're most likely to want next.
    const effectiveAgentId = agentId ?? agents[0]?.workflowId ?? NEW_AGENT
    const creatingNew = effectiveAgentId === NEW_AGENT

    const options = useMemo(
        () => agents.map((agent) => ({value: agent.workflowId, label: agent.name})),
        [agents],
    )

    const handleSubmit = useCallback(
        (markdown: string) => {
            // Creating from an empty description is what made the old button feel broken: it
            // produced an unnamed agent and sent nothing.
            if (creatingNew) {
                if (markdown.trim()) onCreateAgent(markdown)
                return
            }
            startSession({appId: effectiveAgentId, message: markdown})
        },
        [creatingNew, effectiveAgentId, onCreateAgent, startSession],
    )

    return (
        <RichChatInput
            ref={composerRef}
            onSubmit={handleSubmit}
            size="comfortable"
            minHeightClassName="min-h-24"
            textSizeClassName="text-sm"
            sendDisabled={creating}
            sendDisabledReason={creating ? "Creating your agent…" : undefined}
            placeholder={
                creatingNew
                    ? "Describe what the new agent should do…"
                    : "Describe the task, or start the conversation…"
            }
            prefix={
                <Select
                    value={effectiveAgentId}
                    onChange={setAgentId}
                    open={pickerOpen}
                    onOpenChange={setPickerOpen}
                    options={
                        creatingNew
                            ? [...options, {value: NEW_AGENT, label: NEW_AGENT_LABEL}]
                            : options
                    }
                    labelRender={({value, label}) =>
                        value === NEW_AGENT ? (
                            <span className="inline-flex items-center gap-1.5 text-colorPrimary">
                                <PlusIcon size={14} />
                                {NEW_AGENT_LABEL}
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1.5">
                                <RobotIcon size={14} className="text-colorTextTertiary" />
                                {label}
                            </span>
                        )
                    }
                    placeholder="Select an agent"
                    variant="borderless"
                    className="min-w-40"
                    popupRender={(menu) => (
                        <>
                            {menu}
                            <Divider className="my-1" />
                            <button
                                type="button"
                                onClick={() => {
                                    setAgentId(NEW_AGENT)
                                    setPickerOpen(false)
                                }}
                                className="flex w-full cursor-pointer items-center gap-2 border-0 bg-colorFillQuaternary px-3 py-2 text-xs text-colorPrimary"
                            >
                                <PlusIcon size={14} />
                                {NEW_AGENT_LABEL}
                            </button>
                        </>
                    )}
                />
            }
        />
    )
}

export default HomeTaskComposer
