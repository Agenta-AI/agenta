import {useEffect, useMemo, useRef, useState} from "react"

import {workflowFlagsSchema, type Workflow} from "@agenta/entities/workflow"
import {executionItemController} from "@agenta/playground"
import type {ChatMessage as StoredMessage} from "@agenta/playground"
import type {ToolCall} from "@agenta/shared/types"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {getDefaultStore, useAtomValue} from "jotai"
import {within} from "storybook/test"

import {ChatTurns} from "../../../packages/agenta-playground-ui/src/panels/chat/ChatTurns"
import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {
    variantNameCellQueries,
    workflowIds,
    workflowRevision,
    type WorkflowIds,
} from "../../fixtures/workflow"
// The chat panel has no package entry yet, so its parts are imported by their paths.

import {selectRevision} from "./playgroundFixtures"

/** A chat app's revision: one system message and the chat flag. */
const chatRevision = (ids: WorkflowIds): Workflow =>
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
                    messages: [{role: "system", content: "You help Alex plan trips."}],
                    llm_config: {model: "gpt-4o-mini", temperature: 0.2},
                },
            },
        },
    })

const weatherCall: ToolCall = {
    id: "call_1",
    type: "function",
    function: {name: "get_weather", arguments: '{"city":"Lisbon"}'},
}
const gatewayCall: ToolCall = {
    id: "call_2",
    type: "function",
    function: {
        name: "tools__composio__gmail__send__work",
        arguments: '{"to":"sam.lee@example.com","subject":"Lisbon plan"}',
    },
}

interface Turn {
    user: string
    /** Messages of the turn after the user message, in order. */
    replies?: Partial<StoredMessage>[]
}

const assistant = (
    content: string,
    extra: Partial<StoredMessage> = {},
): Partial<StoredMessage> => ({
    role: "assistant",
    content,
    ...extra,
})

const scenarios: Record<string, {turns: Turn[]; run?: "hang" | "fail"; lateReply?: string}> = {
    empty: {turns: [{user: ""}]},
    oneTurn: {
        turns: [
            {
                user: "Where should Alex go in May?",
                replies: [assistant("Lisbon is lovely in May: warm days and few crowds.")],
            },
        ],
    },
    threeTurns: {
        turns: [
            {
                user: "Where should Alex go in May?",
                replies: [assistant("Lisbon is lovely in May: warm days and few crowds.")],
            },
            {
                user: "How many days do I need?",
                replies: [assistant("Three days cover the old town and one day trip to Sintra.")],
            },
            {user: "Which neighborhood should I stay in?"},
        ],
    },
    running: {turns: [{user: "Plan a weekend in Lisbon."}], run: "hang"},
    rerunning: {
        turns: [{user: "Plan a weekend in Lisbon."}],
        run: "hang",
        lateReply: "Day one: Alfama and the castle. Day two: Belem and the river.",
    },
    toolCall: {
        turns: [
            {
                user: "What is the weather in Lisbon?",
                replies: [
                    assistant("", {tool_calls: [weatherCall]}),
                    {
                        role: "tool",
                        name: "get_weather",
                        tool_call_id: "call_1",
                        content: '{"temperature": 22, "unit": "celsius", "sky": "clear"}',
                    },
                    assistant("It is 22 degrees and clear in Lisbon."),
                ],
            },
        ],
    },
    gatewayTool: {
        turns: [
            {
                user: "Email Sam Lee the plan.",
                replies: [
                    assistant("", {tool_calls: [gatewayCall]}),
                    {
                        role: "tool",
                        name: gatewayCall.function.name,
                        tool_call_id: "call_2",
                        content: "",
                    },
                ],
            },
        ],
    },
    error: {turns: [{user: "Plan a trip."}], run: "fail"},
}

const store = getDefaultStore()
const SESSION_ID = (revisionId: string) => `sess:${revisionId}`

/** Runs that never answer, or answer with a failure, so the pane shows those states. */
const patchFetch = (mode: "hang" | "fail") => {
    const original = window.fetch
    window.fetch = (() =>
        mode === "hang"
            ? new Promise<Response>(() => undefined)
            : Promise.resolve(
                  new Response(JSON.stringify({status: {message: "The model is not available."}}), {
                      status: 500,
                  }),
              )) as typeof window.fetch
    return () => {
        window.fetch = original
    }
}

/** A seeded chat. Data-connected: the revision comes from the query cache. */
const Demo = ({
    revisionId,
    scenario,
    width,
}: {
    revisionId: string
    scenario: string
    width?: number
}) => {
    const spec = scenarios[scenario]
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

    useEffect(() => (spec.run ? patchFetch(spec.run) : undefined), [spec.run])

    // Seeds one turn at a time: the next user message is added once the last turn exists.
    useEffect(() => {
        const next = seeded.current
        if (next >= spec.turns.length) return
        const turn = spec.turns[next]
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
        if (next === 0 && turn.user) {
            store.set(executionItemController.actions.patchMessage, {
                target: {turnId: rowId, kind: "user"},
                updater: (m) => (m ? {...m, content: turn.user} : m),
            })
        }
        for (const [index, reply] of (turn.replies ?? []).entries()) {
            store.set(executionItemController.actions.addMessage, {
                message: {
                    id: `msg-${scenario}-${next}-${index}`,
                    role: "assistant",
                    content: "",
                    parentId: rowId,
                    sessionId: SESSION_ID(revisionId),
                    ...reply,
                } as StoredMessage,
            })
        }
        if (seeded.current === spec.turns.length) {
            if (spec.run) {
                store.set(executionItemController.actions.triggerTest, {
                    executionId: revisionId,
                    step: {id: rowId},
                })
                if (spec.lateReply) {
                    store.set(executionItemController.actions.addMessage, {
                        message: {
                            id: `msg-${scenario}-late`,
                            role: "assistant",
                            content: spec.lateReply,
                            parentId: rowId,
                            sessionId: SESSION_ID(revisionId),
                        } as StoredMessage,
                    })
                }
            }
            setReady(true)
        }
    }, [rowIds, spec, scenario, revisionId])

    if (!ready) return null
    return (
        <div className="w-full bg-background text-foreground" style={{maxWidth: width ?? 640}}>
            <ChatTurns entityId={revisionId} />
        </div>
    )
}

const meta = {
    title: "@agenta/mobile/Developer/Playground/ChatTurns",
    component: Demo,
    parameters: {
        agenta: {
            queries: (scope: StoryScope) =>
                variantNameCellQueries(scope, {
                    revision: chatRevision,
                    variantNames: ["default"],
                    deployedTo: [],
                }),
            args: (scope: StoryScope) => ({revisionId: workflowIds(scope).revisionId}),
        },
    },
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

const ready = async (canvasElement: HTMLElement, text: string) => {
    await within(canvasElement).findByText(text, {exact: false})
}

/** One blank user message, the "No output yet" block and the footer. */
export const Empty: Story = {
    args: {revisionId: "", scenario: "empty"},
    play: async ({canvasElement}) => ready(canvasElement, "No output yet"),
}

export const OneTurn: Story = {
    args: {revisionId: "", scenario: "oneTurn"},
    play: async ({canvasElement}) => ready(canvasElement, "Lisbon is lovely"),
}

/** The last turn has no reply yet. */
export const ThreeTurns: Story = {
    args: {revisionId: "", scenario: "threeTurns"},
    play: async ({canvasElement}) => ready(canvasElement, "No output yet"),
}

export const Running: Story = {
    args: {revisionId: "", scenario: "running"},
    play: async ({canvasElement}) => ready(canvasElement, "Generating response"),
}

/** The old reply stays on screen under "Re-running...". */
export const Rerunning: Story = {
    args: {revisionId: "", scenario: "rerunning"},
    play: async ({canvasElement}) => ready(canvasElement, "Re-running"),
}

/** A reply with a tool call, the tool reply after it, then the final answer. */
export const ToolCall: Story = {
    args: {revisionId: "", scenario: "toolCall"},
    play: async ({canvasElement}) => ready(canvasElement, "get_weather"),
}

/** A gateway tool call: the split button calls the tool and sends the result to the chat. */
export const GatewayTool: Story = {
    args: {revisionId: "", scenario: "gatewayTool"},
    play: async ({canvasElement}) => ready(canvasElement, "Call tool and send to chat"),
}

/** A failed run: the Error message. */
export const Error: Story = {
    args: {revisionId: "", scenario: "error"},
    play: async ({canvasElement}) => ready(canvasElement, "not available"),
}

/** At 390px the toolbar stays visible and the controls fit the pane. */
export const Phone: Story = {
    args: {revisionId: "", scenario: "threeTurns", width: 390},
    parameters: {viewport: {defaultViewport: "mobile1"}},
    play: async ({canvasElement}) => ready(canvasElement, "No output yet"),
}
