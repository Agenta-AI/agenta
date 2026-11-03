import {useEffect, useMemo, useRef, useState} from "react"

import {workflowFlagsSchema, type Workflow} from "@agenta/entities/workflow"
import {executionItemController} from "@agenta/playground"
import type {ChatMessage as StoredMessage, SimpleChatMessage} from "@agenta/playground"
import type {MessageContent, ToolCall} from "@agenta/shared/types"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {getDefaultStore, useAtomValue} from "jotai"
import {userEvent, within} from "storybook/test"

import {ChatMessage} from "../../../packages/agenta-playground-ui/src/panels/chat/ChatMessage"
import {PasteLimitDialog as PasteLimitDialogView} from "../../../packages/agenta-playground-ui/src/panels/chat/PasteLimitDialog"
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

const PIXEL =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="

const toolCalls: ToolCall[] = [
    {
        id: "call_1",
        type: "function",
        function: {name: "get_weather", arguments: '{"city":"Lisbon","unit":"celsius"}'},
    },
    {
        id: "call_2",
        type: "function",
        function: {name: "get_flights", arguments: '{"from":"Porto","to":"Lisbon"}'},
    },
]

interface Scenario {
    kind: "user" | "assistant" | "tool"
    /** What the stored messages of the turn are. */
    user?: MessageContent
    reply?: Partial<StoredMessage>
    /** A message shown instead of a stored one, as a failed run does. */
    override?: SimpleChatMessage
}

const scenarios: Record<string, Scenario> = {
    user: {kind: "user", user: "Where should Sam Lee go in May?"},
    userWithAttachments: {
        kind: "user",
        user: [
            {type: "text", text: "Which of these is the better view?"},
            {type: "image_url", image_url: {url: PIXEL}},
            {
                type: "file",
                file: {
                    file_data: "data:application/pdf;base64,JVBERi0xLjQK",
                    filename: "itinerary.pdf",
                    format: "application/pdf",
                },
            },
        ],
    },
    assistant: {
        kind: "assistant",
        user: "Where should Alex go in May?",
        reply: {role: "assistant", content: "Lisbon is lovely in May: warm days and few crowds."},
    },
    assistantJson: {
        kind: "assistant",
        user: "Give me the plan as JSON.",
        reply: {
            role: "assistant",
            content: '{"city": "Lisbon", "days": 3, "highlights": ["Alfama", "Belem"]}',
        },
    },
    assistantToolCalls: {
        kind: "assistant",
        user: "What is the weather and how do I get there?",
        reply: {role: "assistant", content: "", tool_calls: toolCalls},
    },
    toolReply: {
        kind: "tool",
        user: "What is the weather in Lisbon?",
        reply: {
            role: "tool",
            name: "get_weather",
            tool_call_id: "call_1",
            content: '{"temperature": 22, "unit": "celsius", "sky": "clear"}',
        },
    },
    error: {
        kind: "assistant",
        user: "Plan a trip.",
        override: {role: "Error", content: "The model is not available. Try again in a minute."},
    },
    collapsed: {
        kind: "assistant",
        user: "Tell me about Lisbon.",
        reply: {
            role: "assistant",
            content:
                "Lisbon is built on seven hills.\n\nTake tram 28 early, walk Alfama after dinner, and book the day trip to Sintra a week ahead.",
        },
    },
}

const store = getDefaultStore()

/** One message of a seeded chat turn. Data-connected: the revision comes from the query cache. */
const Demo = ({revisionId, scenario}: {revisionId: string; scenario: string}) => {
    const spec = scenarios[scenario]
    useState(() => selectRevision(revisionId))
    const items = useAtomValue(
        useMemo(
            () => executionItemController.selectors.itemsByExecutionId(revisionId),
            [revisionId],
        ),
    )
    const rowId = items[0]?.rowId
    const seeded = useRef(false)
    const [ready, setReady] = useState(false)
    useEffect(() => {
        if (!rowId || seeded.current) return
        seeded.current = true
        if (spec.user !== undefined) {
            store.set(executionItemController.actions.patchMessage, {
                target: {turnId: rowId, kind: "user"},
                updater: (m) => (m ? {...m, content: spec.user as MessageContent} : m),
            })
        }
        if (spec.reply) {
            store.set(executionItemController.actions.addMessage, {
                message: {
                    id: `msg-${scenario}`,
                    role: "assistant",
                    content: "",
                    parentId: rowId,
                    sessionId: `sess:${revisionId}`,
                    ...spec.reply,
                } as StoredMessage,
            })
        }
        setReady(true)
    }, [rowId, spec, scenario, revisionId])

    if (!rowId || !ready) return null
    return (
        <div className="w-full max-w-[560px] bg-background p-4 text-foreground">
            <ChatMessage
                entityId={revisionId}
                rowId={rowId}
                kind={spec.kind}
                messageOverride={spec.override}
            />
        </div>
    )
}

const meta = {
    title: "@agenta/mobile/Developer/Playground/ChatMessage",
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

/** A message the user types: the role select, the view mode and the buttons. */
export const User: Story = {
    args: {revisionId: "", scenario: "user"},
    play: async ({canvasElement}) => ready(canvasElement, "user"),
}

/** A user message with an image and a document already attached. */
export const UserWithAttachments: Story = {
    args: {revisionId: "", scenario: "userWithAttachments"},
    play: async ({canvasElement}) => ready(canvasElement, "itinerary.pdf"),
}

export const Assistant: Story = {
    args: {revisionId: "", scenario: "assistant"},
    play: async ({canvasElement}) => ready(canvasElement, "assistant"),
}

/** A reply that is a JSON object shows as pretty JSON. */
export const AssistantJson: Story = {
    args: {revisionId: "", scenario: "assistantJson"},
    play: async ({canvasElement}) => ready(canvasElement, "assistant"),
}

/** A reply with tool calls: one read-only editor for each call, folded at first. */
export const AssistantToolCalls: Story = {
    args: {revisionId: "", scenario: "assistantToolCalls"},
    play: async ({canvasElement}) => ready(canvasElement, "get_weather"),
}

/** The result of a tool call. The role is fixed. */
export const ToolReply: Story = {
    args: {revisionId: "", scenario: "toolReply"},
    play: async ({canvasElement}) => ready(canvasElement, "call_1"),
}

/** A failed run: the Error role, read only. */
export const Error: Story = {
    args: {revisionId: "", scenario: "error"},
    play: async ({canvasElement}) => ready(canvasElement, "Error"),
}

/** A long reply folded to three lines with the Collapse button. */
export const Collapsed: Story = {
    args: {revisionId: "", scenario: "collapsed"},
    play: async ({canvasElement}) => {
        await ready(canvasElement, "Lisbon")
        await userEvent.click(await within(canvasElement).findByRole("button", {name: "Collapse"}))
    },
}

/** The dialog a paste over the limit opens. */
export const PasteLimitDialog: Story = {
    args: {revisionId: "", scenario: "user"},
    render: () => <PasteLimitDialogDemo />,
}

const PasteLimitDialogDemo = () => (
    <PasteLimitDialogView
        paste={{pastedText: "x".repeat(62_400), maxPasteChars: 50_000, overBy: 12_400}}
        onAttach={() => {}}
        onClose={() => {}}
    />
)
