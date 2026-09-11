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
    // Both DERIVE from the roster until someone chooses otherwise, rather than snapshotting it at
    // mount: the list can arrive empty and fill a moment later, and a snapshot left the page stuck
    // on templates with a roster sitting behind the other tab.
    //
    // `null` means "no choice made yet, follow the data". An explicit choice outlives the data.
    const [tabChoice, setTabChoice] = useState<HomeListTab | null>(null)
    const [bindingChoice, setBindingChoice] = useState<Binding | null>(null)
    const hasAgents = agents.length > 0
    // `loading` keeps the agents tab in play before the roster resolves — otherwise a project
    // that turns out to have agents opens on templates, and a FAILED fetch hides its own retry.
    const tab = tabChoice ?? (hasAgents || loading || errorSlot ? "agents" : "templates")
    const binding: Binding =
        bindingChoice ?? (hasAgents ? {kind: "agent", id: null} : {kind: "new"})
    const inputRef = useRef<RichChatInputHandle | null>(null)

    // Resolved ONCE, here, because the composer's dock and the list's check are the same fact. A
    // stale id (an agent archived under the page) falls back rather than naming something gone.
    const boundAgentId =
        binding.kind !== "agent"
            ? null
            : ((binding.id && agents.some((agent) => agent.id === binding.id)
                  ? binding.id
                  : agents[0]?.id) ?? null)

    /**
     * Put the caret in the composer, and a seed with it.
     *
     * `RichChatInput` is lazy behind Suspense, so the handle is null for however long that chunk
     * takes — a single frame's delay was enough on a warm load and not enough on a cold one, which
     * silently dropped the template's instruction and left create mode submitting empty text.
     * Retries until the handle exists, bounded so a composer that never mounts cannot spin.
     */
    const focusSoon = useCallback((seed?: string) => {
        let framesLeft = 120
        const attempt = () => {
            const input = inputRef.current
            if (!input) {
                if (framesLeft-- > 0) requestAnimationFrame(attempt)
                return
            }
            if (seed !== undefined) input.setMarkdown(seed)
            input.focus()
        }
        requestAnimationFrame(attempt)
    }, [])

    // "+ New agent" answers "what next" with "type here", so the caret goes there.
    const startCreating = useCallback(() => {
        setBindingChoice({kind: "new"})
        focusSoon()
    }, [focusSoon])

    // Binding an agent is half the sentence; the caret goes where the other half is typed. Every
    // row in this list leaves you in the composer, whichever tab it came from.
    const selectAgent = useCallback(
        (id: string) => {
            setBindingChoice({kind: "agent", id})
            focusSoon()
        },
        [focusSoon],
    )

    // A template row SELECTS rather than creates: it binds the template in the dock and writes its
    // instruction into the composer, so the thing about to be built can be read and edited first.
    // Creating on click sent people to a new agent they had not seen the brief for.
    const selectTemplate = useCallback(
        (template: AgentStarterTemplate) => {
            setBindingChoice({kind: "template", template})
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
                        attachments={attachments}
                        agentId={boundAgentId}
                        onAgentChange={selectAgent}
                        mode={binding.kind === "agent" ? "task" : "create"}
                        template={binding.kind === "template" ? binding.template : null}
                        onCreate={async (input) => {
                            await onCreateFromPrompt({
                                ...input,
                                templateName:
                                    binding.kind === "template" ? binding.template.name : undefined,
                            })
                            setBindingChoice({kind: "agent", id: null})
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
                    onTabChange={setTabChoice}
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
