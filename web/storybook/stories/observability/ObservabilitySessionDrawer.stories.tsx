import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, userEvent, waitFor, within} from "storybook/test"

import ObservabilitySessionDrawer from "../../../mobile/src/features/observability/sessionDrawer/ObservabilitySessionDrawer"
import type {SessionTraces} from "../../../mobile/src/features/observability/sessionDrawer/sessionDrawerQueries"
import {SessionDrawerSkeleton} from "../../../mobile/src/features/observability/sessionDrawer/states/SessionDrawerSkeleton"
import type {QueryFixtures, StoryScope} from "../../.storybook/decorators/withAgentaData"

/**
 * The /m Observability session drawer: the traces of one session, oldest first, with a tree
 * beside them. Data-connected: the session traces come from the seeded query cache. The address
 * bar owns open state in the app, so these stories hold the drawer open.
 */
const meta = {
    title: "@agenta/mobile/Observability/SessionDrawer",
    component: ObservabilitySessionDrawer,
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    'Opens from a row on the Sessions tab of the /m Observability page, or from a link with `?session=`. Below 720px it shows the traces only; "View trace" reaches the spans.\n\n**Used in:** the /m Observability page. It loads with `next/dynamic` on first open.',
            },
        },
    },
} satisfies Meta<typeof ObservabilitySessionDrawer>

export default meta
type Story = StoryObj<typeof meta>
type TraceSpanNode = SessionTraces["traces"][number]

const trace = (
    scope: StoryScope,
    n: number,
    minute: number,
    data: Record<string, unknown>,
    extra: Partial<TraceSpanNode> = {},
    metrics = {tokens: 120, cost: 0.0021, ms: 1800},
): TraceSpanNode => ({
    trace_id: scope.id(`trace-${n}`),
    span_id: scope.id(`span-${n}`),
    span_name: "chat",
    span_type: "workflow",
    start_time: `2026-01-01T09:${String(minute).padStart(2, "0")}:00Z`,
    status_code: "STATUS_CODE_OK",
    attributes: {
        ag: {
            data,
            metrics: {
                tokens: {cumulative: {total: metrics.tokens}},
                costs: {cumulative: {total: metrics.cost}},
                duration: {cumulative: metrics.ms},
            },
        },
    },
    ...extra,
})

const chatTraces = (scope: StoryScope): TraceSpanNode[] => [
    trace(scope, 1, 0, {
        inputs: {messages: [{role: "user", content: "Can you plan a lunch for the team?"}]},
        outputs: {role: "assistant", content: "Sure. How many people, and any food limits?"},
        parameters: {prompt: {llm_config: {model: "model-one"}}},
    }),
    trace(
        scope,
        2,
        3,
        {
            inputs: {
                messages: [
                    {role: "user", content: "Can you plan a lunch for the team?"},
                    {role: "assistant", content: "Sure. How many people, and any food limits?"},
                    {role: "user", content: "Eight people.\nTwo of them eat no meat."},
                ],
            },
            outputs: {
                role: "assistant",
                content: "Here are three places that fit eight people and have a meat-free menu.",
            },
            parameters: {prompt: {llm_config: {model: "model-two"}}},
        },
        {
            children: [
                {
                    trace_id: scope.id("trace-2"),
                    span_id: scope.id("span-2-llm"),
                    span_name: "llm call",
                    span_type: "llm",
                    start_time: "2026-01-01T09:03:01Z",
                },
            ],
        },
        {tokens: 310, cost: 0.0064, ms: 2600},
    ),
    trace(
        scope,
        3,
        9,
        {
            inputs: {
                messages: [{role: "user", content: "Book the second one."}],
            },
        },
        {status_code: "STATUS_CODE_ERROR", status_message: "The booking tool did not answer."},
        {tokens: 40, cost: 0.0004, ms: 30000},
    ),
]

const completionTraces = (scope: StoryScope): TraceSpanNode[] => [
    trace(scope, 1, 0, {
        inputs: {topic: "tea", tone: "friendly"},
        outputs: {output: "Tea is a warm drink that brings people together."},
    }),
]

const seed =
    (build: (scope: StoryScope) => TraceSpanNode[], truncated = false) =>
    (scope: StoryScope): QueryFixtures => [
        [
            ["observability-session-traces", scope.projectId, null, scope.id("session")],
            {traces: build(scope), truncated},
        ],
    ]

const withSession = (scope: StoryScope) => ({
    sessionId: scope.id("session"),
    spanId: null,
    onSelectSession: () => undefined,
    onClose: () => undefined,
})

const args = {
    sessionId: "",
    spanId: null,
    onSelectSession: () => undefined,
    onClose: () => undefined,
}

const story = (build: (scope: StoryScope) => TraceSpanNode[], truncated = false): Story => ({
    args,
    parameters: {agenta: {queries: seed(build, truncated), args: withSession}},
})

export const ChatSession: Story = story(chatTraces)

export const CompletionSession: Story = story(completionTraces)

export const Truncated: Story = story(chatTraces, true)

export const Empty: Story = story(() => [])

/** Nothing is seeded and there is no server, so the request fails. */
export const LoadError: Story = {
    args,
    parameters: {agenta: {args: withSession}},
}

/** The body while the traces load. */
export const Loading: Story = {
    args,
    render: () => (
        <div className="flex h-screen">
            <SessionDrawerSkeleton narrow={false} />
        </div>
    ),
}

export const Phone: Story = {
    ...story(chatTraces),
    globals: {viewport: {value: "mobile1", isRotated: false}},
}

export const AnnotationsHidden: Story = {
    ...story(chatTraces),
    play: async () => {
        const screen = within(document.body)
        await userEvent.click(await screen.findByRole("button", {name: "Hide annotations"}))
        await waitFor(() =>
            expect(screen.getByRole("button", {name: "Show annotations"})).toBeVisible(),
        )
    },
}

export const Expanded: Story = {
    ...story(chatTraces),
    play: async () => {
        const screen = within(document.body)
        await userEvent.click(await screen.findByRole("button", {name: "Make the drawer wider"}))
        await waitFor(() =>
            expect(screen.getByRole("button", {name: "Make the drawer narrower"})).toBeVisible(),
        )
    },
}
