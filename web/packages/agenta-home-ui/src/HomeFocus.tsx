import {useCallback, useState, type ReactNode} from "react"

import type {useComposerAttachments} from "@agenta/chat/hooks"
import {AGENT_TEMPLATES, type AgentStarterTemplate} from "@agenta/entities/workflow"

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
    /** Create an agent from what was typed in create mode. */
    onCreateFromPrompt: (input: {text: string}) => void | Promise<void>
    onCreateFromTemplate: (template: AgentStarterTemplate) => void
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
 *
 * NOTE: the create-mode ring animates through `animate-composer-ring`/`animate-composer-ring-in`,
 * whose keyframes are the HOST's (this package ships no CSS and has no motion dependency). A host
 * without them renders a still ring, silently.
 */
export const HomeFocus = ({
    className,
    title = "What should we work on?",
    agents,
    attachments,
    onStartTask,
    onCreateFromPrompt,
    onCreateFromTemplate,
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

    // Picking an agent is an answer to "which agent runs this", so it also answers "am I creating
    // one" — leaving create mode on would send the pick nowhere.
    const selectAgent = useCallback((next: string) => {
        setAgentId(next)
        setCreating(false)
    }, [])

    return (
        <div className={`flex w-full flex-1 flex-col overflow-y-auto ${className ?? ""}`}>
            <div className="mx-auto flex w-full max-w-[620px] flex-col gap-[26px]">
                <HomeGreeting title={title} />

                <div className="relative box-border rounded-[9px] p-px">
                    {creating ? (
                        // A conic sweep behind the composer's own border, clipped to its radius.
                        <div className="animate-composer-ring-in pointer-events-none absolute inset-0 overflow-hidden rounded-[9px]">
                            <div
                                className="animate-composer-ring absolute left-1/2 top-1/2 w-[170%] pb-[170%]"
                                style={{
                                    background:
                                        "conic-gradient(from 0deg, transparent 0 58%, color-mix(in oklab, var(--ag-colorText) 50%, transparent) 80%, transparent 100%)",
                                }}
                            />
                        </div>
                    ) : null}
                    {/* Opaque, so the sweep behind it shows only as the 1px rim the padding
                        leaves — a composer you can read the animation through is a distraction,
                        not a border. */}
                    <div
                        className={`relative flex flex-col ${
                            creating
                                ? "overflow-hidden rounded-lg bg-[var(--ag-colorBgContainer)]"
                                : ""
                        }`}
                    >
                        <HomeTaskComposer
                            agents={agents.map((agent) => ({id: agent.id, name: agent.name}))}
                            attachments={attachments}
                            agentId={agentId}
                            onAgentChange={selectAgent}
                            mode={creating ? "create" : "task"}
                            onCreate={async (input) => {
                                await onCreateFromPrompt(input)
                                setCreating(false)
                            }}
                            onCancelCreate={() => setCreating(false)}
                            onStart={onStartTask}
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
                    onPickTemplate={onCreateFromTemplate}
                    templatesHref={templatesHref}
                    onNew={() => setCreating(true)}
                    loading={loading}
                    loadingSlot={loadingSlot}
                    emptySlot={emptySlot}
                    errorSlot={errorSlot}
                />
            </div>
        </div>
    )
}
