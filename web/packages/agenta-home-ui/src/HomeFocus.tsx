import {useCallback, useRef, useState, type CSSProperties, type ReactNode} from "react"

import type {useComposerAttachments} from "@agenta/chat/hooks"
import {templateBuilderMessage, type AgentStarterTemplate} from "@agenta/entities/workflow"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"

import {HomeEntityList, type HomeListAgent, type HomeListTab} from "./HomeEntityList"
import {HomeGreeting} from "./HomeGreeting"
import {HomeTaskComposer} from "./HomeTaskComposer"

/**
 * What the composer is aimed at. ONE value rather than three flags: an agent, a template, or a
 * blank create are mutually exclusive, and as separate `creating`/`agentId`/`template` state they
 * could contradict — a bound template with `creating` false was representable and meaningless.
 * `agent` with a null id means "whichever agent leads the list".
 */
type Binding =
    | {kind: "agent"; id: string | null}
    | {kind: "template"; template: AgentStarterTemplate}
    | {kind: "new"}

export interface HomeFocusProps {
    /** The page frame — the host's column cap and gutters, exactly as `HomeOverview` takes it. */
    className?: string
    title?: string
    agents: HomeListAgent[]
    /** The starter catalogue, from the host — the same list its templates route renders. */
    templates: AgentStarterTemplate[]
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
 * "+ New agent" does not navigate. It flips THIS composer into create mode, so describing an agent
 * and describing a task happen in the same box, one above the same list.
 */
export const HomeFocus = ({
    className,
    title = "What should we work on?",
    agents,
    templates,
    attachments,
    onStartTask,
    onCreateFromPrompt,
    templatesHref,
    loading,
    loadingSlot,
    emptySlot,
    errorSlot,
}: HomeFocusProps) => {
    // An empty project opens where the only thing it can do is: the templates, with the composer
    // already describing an agent. Read once at mount, which is when the host knows the answer —
    // Home does not render until the list has resolved.
    const startsEmpty = agents.length === 0
    const [tab, setTab] = useState<HomeListTab>(startsEmpty ? "templates" : "agents")
    const [binding, setBinding] = useState<Binding>(
        startsEmpty ? {kind: "new"} : {kind: "agent", id: null},
    )
    const inputRef = useRef<RichChatInputHandle | null>(null)

    // Resolved ONCE, here, because the composer's dock and the list's check are the same fact. A
    // stale id (an agent archived under the page) falls back rather than naming something gone.
    const boundAgentId =
        binding.kind !== "agent"
            ? null
            : ((binding.id && agents.some((agent) => agent.id === binding.id)
                  ? binding.id
                  : agents[0]?.id) ?? null)

    // The rich input is lazy, so on the click's own tick the handle can still be null.
    const focusSoon = useCallback((seed?: string) => {
        requestAnimationFrame(() => {
            if (seed !== undefined) inputRef.current?.setMarkdown(seed)
            inputRef.current?.focus()
        })
    }, [])

    // "+ New agent" answers "what next" with "type here", so the caret goes there.
    const startCreating = useCallback(() => {
        setBinding({kind: "new"})
        focusSoon()
    }, [focusSoon])

    const selectAgent = useCallback((id: string) => setBinding({kind: "agent", id}), [])

    // A template row SELECTS rather than creates: it binds the template in the dock and writes its
    // instruction into the composer, so the thing about to be built can be read and edited first.
    // Creating on click sent people to a new agent they had not seen the brief for.
    const selectTemplate = useCallback(
        (template: AgentStarterTemplate) => {
            setBinding({kind: "template", template})
            focusSoon(templateBuilderMessage(template))
        },
        [focusSoon],
    )

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
                    <HomeTaskComposer
                        voice
                        agents={agents}
                        attachments={attachments}
                        agentId={boundAgentId}
                        mode={binding.kind === "agent" ? "task" : "create"}
                        template={binding.kind === "template" ? binding.template : null}
                        onCreate={async (input) => {
                            await onCreateFromPrompt({
                                ...input,
                                templateName:
                                    binding.kind === "template" ? binding.template.name : undefined,
                            })
                            setBinding({kind: "agent", id: null})
                        }}
                        onClear={startCreating}
                        onStart={onStartTask}
                        inputRef={inputRef}
                        // Home has a page under the composer — the list it grows over. A chat dock
                        // has nothing below it to push, so it keeps the taller default.
                        maxHeightClassName="max-h-28"
                    />
                </div>

                <HomeEntityList
                    tab={tab}
                    onTabChange={setTab}
                    agents={agents}
                    templates={templates}
                    // Null while creating, so the list marks nothing when no agent is bound.
                    selectedAgentId={boundAgentId}
                    onSelectAgent={selectAgent}
                    onPickTemplate={selectTemplate}
                    selectedTemplateKey={
                        binding.kind === "template" ? binding.template.key : undefined
                    }
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
