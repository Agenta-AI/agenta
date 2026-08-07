import React from "react"

import {ChatMode, CompletionMode} from "@agenta/playground-ui/execution-row"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {
    StoryPlaygroundUIProvider,
    entityIds,
    seedPlaygroundLoadable,
} from "./_fixtures/playgroundLoadable"

/**
 * `ChatMode` and `CompletionMode` — the two arms `ExecutionItems` picks between. Both are thin:
 * they choose which rows exist and hand each one to `ExecutionRow`. Storying them separately
 * from `ExecutionItems` isolates that choice from the header and the loading placeholder.
 *
 * These are **showcases**, not parity rows — the migration in this tree is merged, so there is
 * no antd half to diff. What they gate is that the row source resolves: `CompletionMode` reads
 * `rowIdsForEntity`, `ChatMode` reads `itemsByExecutionId` plus the variable rows, and both
 * return an empty list (and render nothing but the footer) when the loadable is missing.
 *
 * The mode is NOT a prop. It follows `flags.is_chat` on the seeded revision, which is why each
 * story here seeds a different entity — see `_fixtures/playgroundLoadable`.
 *
 * ## Not covered
 *
 * `ChatMode`'s comparison arm. In comparison the turns render through
 * `ExecutionItemComparisonView`, a different component that owns the column grid; `ChatMode`
 * itself renders the same single-column list either way.
 */
const meta = {
    title: "@agenta/playground-ui/Execution/Modes",
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "The chat and completion arms of ExecutionItems, each on its own seeded loadable.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const Frame = ({children}: {children: React.ReactNode}) => (
    <div className="w-full bg-colorBgContainer">
        <StoryPlaygroundUIProvider>{children}</StoryPlaygroundUIProvider>
    </div>
)

const [COMPLETION] = entityIds("mode-completion")
const COMPLETION_COMPARE = entityIds("mode-completion-compare", 2)
const [CHAT] = entityIds("mode-chat")
const [CHAT_EMPTY] = entityIds("mode-chat-empty")

// ---------------------------------------------------------------------------
// CompletionMode
// ---------------------------------------------------------------------------

/** One `ExecutionRow` per test case, plus the "Test case" add button `withControls` enables. */
export const CompletionRows: Story = {
    parameters: {
        agenta: seedPlaygroundLoadable({
            entities: [{id: COMPLETION, label: "classify", variables: ["ticket", "locale"]}],
            rows: [
                {ticket: "Where is my refund?", locale: "en-GB"},
                {ticket: "Wo bleibt meine Rückerstattung?", locale: "de-DE"},
            ],
            results: [{row: 0, entity: COMPLETION, output: "billing", traceId: "tr-1c04"}],
        }),
    },
    render: () => (
        <Frame>
            <CompletionMode entityId={COMPLETION} withControls />
        </Frame>
    ),
}

/**
 * Two entities. Comparison collapses to ONE row — the shared input column — because the
 * per-variant output cells belong to the comparison grid, not to this component. The add-row
 * button moves too: `CompletionMode` stops rendering its own and passes `showAddRowButton`
 * down to `ComparisonLayout`, which puts it next to the run control.
 */
export const CompletionComparison: Story = {
    parameters: {
        agenta: seedPlaygroundLoadable({
            entities: [
                {id: COMPLETION_COMPARE[0], label: "classify v1", variables: ["ticket"]},
                {id: COMPLETION_COMPARE[1], label: "classify v2", variables: ["ticket"]},
            ],
            rows: [{ticket: "The API returns 401 after I rotated my key."}],
            results: [
                {row: 0, entity: COMPLETION_COMPARE[0], output: "auth"},
                {row: 0, entity: COMPLETION_COMPARE[1], output: "auth / credentials"},
            ],
        }),
    },
    render: () => (
        <Frame>
            <CompletionMode entityId={COMPLETION_COMPARE[0]} withControls />
        </Frame>
    ),
}

// ---------------------------------------------------------------------------
// ChatMode
// ---------------------------------------------------------------------------

/**
 * A two-turn conversation. The read-only prompt messages above it come from the revision's
 * `parameters.prompt.messages`, not from the chat store — ChatMode lists them separately so the
 * system prompt stays visible without being part of the conversation.
 */
export const ChatConversation: Story = {
    parameters: {
        agenta: seedPlaygroundLoadable({
            entities: [
                {
                    id: CHAT,
                    label: "support-bot",
                    chat: true,
                    promptMessages: [
                        {role: "system", content: "You are a concise billing support agent."},
                    ],
                },
            ],
            turns: [
                {
                    user: "My invoice shows two charges for March.",
                    replies: {[CHAT]: "I found a duplicate charge of $49 and refunded it."},
                },
                {
                    user: "How long until the refund lands?",
                    replies: {[CHAT]: "Five to ten business days, depending on your bank."},
                },
            ],
        }),
    },
    render: () => (
        <Frame>
            <ChatMode entityId={CHAT} />
        </Frame>
    ),
}

/**
 * No seeded turns. `generationRowIdsAtom` bootstraps one blank user message on first read, so
 * the empty conversation is a single editable turn — not an empty list.
 */
export const ChatEmpty: Story = {
    parameters: {
        agenta: seedPlaygroundLoadable({
            entities: [{id: CHAT_EMPTY, label: "support-bot", chat: true}],
        }),
    },
    render: () => (
        <Frame>
            <ChatMode entityId={CHAT_EMPTY} />
        </Frame>
    ),
}
