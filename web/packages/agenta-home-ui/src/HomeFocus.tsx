import {useCallback, useRef, useState, type CSSProperties, type ReactNode} from "react"

import type {useComposerAttachments} from "@agenta/chat/hooks"
import {
    AGENT_TEMPLATES,
    templateBuilderMessage,
    type AgentStarterTemplate,
} from "@agenta/entities/workflow"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"

import {HomeEntityList, type HomeListAgent, type HomeListTab} from "./HomeEntityList"
import {HomeGreeting} from "./HomeGreeting"
import {HomeTaskComposer} from "./HomeTaskComposer"

export interface HomeFocusProps {
    /** The page frame — the host's column cap and gutters, exactly as `HomeOverview` takes it. */
    className?: string
    title?: string
    agents: HomeListAgent[]
    /** The attachment engine; the host owns its rollout flag and scope. */
    attachments: ReturnType<typeof useComposerAttachments>
    /** Run the task with the bound agent. */
    onStartTask: (input: {agentId: string; text: string}) => void | Promise<void>
    /**
     * Create an agent from what was typed in create mode. A template contributes only its NAME —
     * its instruction is already in the composer, where it can be edited before sending.
     */
    onCreateFromPrompt: (input: {text: string; templateName?: string}) => void | Promise<void>
    /** Where "Browse all N templates" lands. */
    templatesHref: string
    /** Host extras in the composer's prefix (the voice mic). */
    composerExtraPrefix?: ReactNode
    /** The agents list's states — the host's own designed versions. */
    loading?: boolean
    loadingSlot?: ReactNode
    emptySlot?: ReactNode
    errorSlot?: ReactNode
}

/**
 * Home: one question, one composer, one list.
 *
 * The page keeps a single job. What is already in flight (sessions, automation runs) and what is
 * merely informative (next triggers, usage) live on the pages that own them — carried here as
 * summaries they made Home a table of contents for other pages rather than a place to start work.
 *
 * "+ New" does not navigate. It flips THIS composer into create mode, so describing an agent and
 * describing a task happen in the same box, one above the same list.
 */
export const HomeFocus = ({
    className,
    title = "What should we work on?",
    agents,
    attachments,
    onStartTask,
    onCreateFromPrompt,
    templatesHref,
    composerExtraPrefix,
    loading,
    loadingSlot,
    emptySlot,
    errorSlot,
}: HomeFocusProps) => {
    const [tab, setTab] = useState<HomeListTab>("agents")
    const [creating, setCreating] = useState(false)
    const [agentId, setAgentId] = useState<string | null>(null)
    const [template, setTemplate] = useState<AgentStarterTemplate | null>(null)
    const inputRef = useRef<RichChatInputHandle | null>(null)

    // "+ New" answers "what next" with "type here", so the caret goes there. A frame late: the
    // rich input is lazy, so on the click's own tick the handle can still be null.
    const startCreating = useCallback(() => {
        setCreating(true)
        setTemplate(null)
        requestAnimationFrame(() => inputRef.current?.focus())
    }, [])

    // Picking an agent is an answer to "which agent runs this", so it also answers "am I creating
    // one" — leaving create mode on would send the pick nowhere.
    const selectAgent = useCallback((next: string) => {
        setAgentId(next)
        setTemplate(null)
        setCreating(false)
    }, [])

    // A template row SELECTS rather than creates: it binds the template in the dock and writes its
    // instruction into the composer, so the thing about to be built can be read and edited first.
    // Creating on click sent people to a new agent they had not seen the brief for.
    const selectTemplate = useCallback((next: AgentStarterTemplate) => {
        setTemplate(next)
        setCreating(true)
        requestAnimationFrame(() => {
            inputRef.current?.setMarkdown(templateBuilderMessage(next))
            inputRef.current?.focus()
        })
    }, [])

    // `overflow-x-hidden` is deliberate: `overflow-y-auto` alone makes overflow-x compute to
    // `auto`, so the list's 8px hover bleed became a sideways scroll. The page scrolls one way.
    return (
        <div
            className={`flex w-full flex-1 flex-col overflow-y-auto overflow-x-hidden ${className ?? ""}`}
        >
            <div className="mx-auto flex w-full max-w-[620px] flex-col gap-[26px]">
                <HomeGreeting title={title} />

                {/* Home's send is the primary, not the composer accent — the page has one thing to
                    press. `colorPrimary` already carries the brand's own answer per theme: ink on
                    light, brand yellow on dark. `colorBgContainer` is the readable counterpart to
                    both, so the pair never needs a second definition here. */}
                <div
                    className="relative box-border"
                    style={
                        {
                            "--ag-composer-send-bg": "var(--ag-colorPrimary)",
                            "--ag-composer-send-fg": "var(--ag-colorBgContainer)",
                            "--ag-composer-send-hover-bg": "var(--ag-colorPrimaryHover)",
                        } as CSSProperties
                    }
                >
                    <div>
                        <HomeTaskComposer
                            agents={agents.map((agent) => ({id: agent.id, name: agent.name}))}
                            attachments={attachments}
                            agentId={agentId}
                            mode={creating ? "create" : "task"}
                            template={template}
                            onCreate={async (input) => {
                                await onCreateFromPrompt({
                                    ...input,
                                    templateName: template?.name,
                                })
                                setTemplate(null)
                                setCreating(false)
                            }}
                            onClearAgent={startCreating}
                            onStart={onStartTask}
                            inputRef={inputRef}
                            extraPrefix={composerExtraPrefix}
                        />
                    </div>
                </div>

                <HomeEntityList
                    tab={tab}
                    onTabChange={setTab}
                    agents={agents}
                    templates={AGENT_TEMPLATES}
                    selectedAgentId={agentId ?? agents[0]?.id}
                    onSelectAgent={selectAgent}
                    onPickTemplate={selectTemplate}
                    selectedTemplateKey={template?.key}
                    templatesHref={templatesHref}
                    onNew={startCreating}
                    loading={loading}
                    loadingSlot={loadingSlot}
                    emptySlot={emptySlot}
                    errorSlot={errorSlot}
                />
            </div>
        </div>
    )
}
