import {useEffect, useMemo, useRef, useState} from "react"

import {workflowFlagsSchema, type Workflow} from "@agenta/entities/workflow"
import {executionItemController} from "@agenta/playground"
import type {ChatMessage as StoredMessage} from "@agenta/playground"
import {RunsPanelSkeleton} from "@agenta/playground-ui/panels/runs"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {getDefaultStore, useAtomValue} from "jotai"
import {within} from "storybook/test"

import {ChatPanel} from "../../../packages/agenta-playground-ui/src/panels/chat"
import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {
    variantNameCellQueries,
    workflowIds,
    workflowRevision,
    type WorkflowIds,
} from "../../fixtures/workflow"

import {withAppBoxSizing} from "./borderBox"
import {selectRevision} from "./playgroundFixtures"

/** A chat app's revision; the system message references a variable when `withVariable` is set. */
const chatRevision =
    (withVariable: boolean) =>
    (ids: WorkflowIds): Workflow =>
        workflowRevision(ids, {
            slug: "trip-planner-v2",
            name: "default",
            version: 2,
            message: "Plan trips",
            flags: workflowFlagsSchema.parse({is_application: true, is_chat: true}),
            data: {
                uri: "agenta:builtin:chat:v0",
                parameters: {
                    prompt: {
                        messages: [
                            {
                                role: "system",
                                content: withVariable
                                    ? "You help {{name}} plan trips."
                                    : "You help travelers plan trips.",
                            },
                        ],
                        llm_config: {model: "gpt-4o-mini", temperature: 0.2},
                    },
                },
            },
        })

const queries = (withVariable: boolean) => (scope: StoryScope) =>
    variantNameCellQueries(scope, {
        revision: chatRevision(withVariable),
        variantNames: ["default"],
        deployedTo: [],
    })

interface Turn {
    user: string
    reply?: string
}

const conversation: Turn[] = [
    {
        user: "Where should I go in May?",
        reply: "Lisbon is lovely in May: warm days and few crowds.",
    },
    {user: "How many days do I need?", reply: "Three days cover the old town and a day trip."},
    {user: "Which neighborhood should I stay in?"},
]

const store = getDefaultStore()

/** Runs that never answer, so the pane shows a run in progress. */
const hangFetch = () => {
    const original = window.fetch
    window.fetch = (() => new Promise<Response>(() => undefined)) as typeof window.fetch
    return () => {
        window.fetch = original
    }
}

/** The chat pane, with a seeded conversation. Data-connected: the revision comes from the cache. */
const Demo = ({
    revisionId,
    turns = [],
    running = false,
    width,
}: {
    revisionId: string
    turns?: Turn[]
    running?: boolean
    width?: number
}) => {
    useState(() => selectRevision(revisionId))
    const items = useAtomValue(
        useMemo(
            () => executionItemController.selectors.itemsByExecutionId(revisionId),
            [revisionId],
        ),
    )
    const rowIds = useMemo(() => Array.from(new Set(items.map((item) => item.rowId))), [items])
    const seeded = useRef(0)
    const [ready, setReady] = useState(false)

    useEffect(() => (running ? hangFetch() : undefined), [running])

    // Seeds one turn at a time: the next user message is added once the last turn exists.
    useEffect(() => {
        const next = seeded.current
        if (next >= turns.length) {
            if (turns.length === 0) setReady(true)
            return
        }
        const turn = turns[next]
        const rowId = rowIds[next]
        if (!rowId) {
            if (next > 0 && rowIds.length === next) {
                store.set(executionItemController.actions.addUserMessage, {
                    userMessage: {role: "user", content: turn.user},
                })
            }
            return
        }
        seeded.current = next + 1
        if (next === 0) {
            store.set(executionItemController.actions.patchMessage, {
                target: {turnId: rowId, kind: "user"},
                updater: (m) => (m ? {...m, content: turn.user} : m),
            })
        }
        if (turn.reply) {
            store.set(executionItemController.actions.addMessage, {
                message: {
                    id: `msg-reply-${next}`,
                    role: "assistant",
                    content: turn.reply,
                    parentId: rowId,
                    sessionId: `sess:${revisionId}`,
                } as StoredMessage,
            })
        }
        if (seeded.current === turns.length) {
            if (running) {
                store.set(executionItemController.actions.triggerTest, {
                    executionId: revisionId,
                    step: {id: rowId},
                })
            }
            setReady(true)
        }
    }, [rowIds, turns, running, revisionId])

    if (!ready) return null
    return (
        <div
            className="h-[640px] w-full overflow-y-auto border border-border bg-background text-foreground"
            style={{maxWidth: width ?? 720}}
        >
            <ChatPanel revisionId={revisionId} />
        </div>
    )
}

const meta = {
    title: "@agenta/mobile/Developer/Playground/ChatPanel",
    component: Demo,
    parameters: {
        layout: "fullscreen",
        agenta: {
            queries: queries(true),
            args: (scope: StoryScope) => ({revisionId: workflowIds(scope).revisionId}),
        },
    },
    decorators: [withAppBoxSizing],
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

const ready = async (canvasElement: HTMLElement, text: string) => {
    await within(canvasElement).findByText(text, {exact: false})
}

/** What the pane shows while the chat code loads. */
export const Loading: Story = {
    args: {revisionId: ""},
    render: () => (
        <div className="w-full max-w-[720px] border border-border bg-background">
            <RunsPanelSkeleton />
        </div>
    ),
}

/** A prompt with no variables: one empty message, the "No output yet" block and the footer. */
export const Empty: Story = {
    args: {revisionId: ""},
    parameters: {agenta: {queries: queries(false)}},
    play: async ({canvasElement}) => ready(canvasElement, "No output yet"),
}

/** The prompt references a variable: its input sits above the prompt's own messages. */
export const WithVariables: Story = {
    args: {revisionId: ""},
    play: async ({canvasElement}) => ready(canvasElement, "name"),
}

export const Conversation: Story = {
    args: {revisionId: "", turns: conversation},
    play: async ({canvasElement}) => ready(canvasElement, "Lisbon is lovely"),
}

export const Running: Story = {
    args: {revisionId: "", turns: [{user: "Plan a weekend in Lisbon."}], running: true},
    play: async ({canvasElement}) => ready(canvasElement, "Generating response"),
}

/** At 390px the toolbar stays visible, the pane scrolls and the footer is not sticky. */
export const Phone: Story = {
    args: {revisionId: "", turns: conversation, width: 390},
    parameters: {viewport: {defaultViewport: "mobile1"}},
    play: async ({canvasElement}) => ready(canvasElement, "Lisbon is lovely"),
}
