import {useState} from "react"

import {projectPermissionQueryKey} from "@agenta/entities/access"
import {projectIdAtom} from "@agenta/shared/state"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"
import {expect, userEvent, within} from "storybook/test"

import {AddToTestsetSheet} from "../../../mobile/src/features/observability/addToTestset/AddToTestsetSheet"
import type {StoryScope} from "../../.storybook/decorators/withAgentaData"

const COMPLETION_SPANS = {
    "span-a": {inputs: {country: "France"}, outputs: "Paris"},
    "span-b": {inputs: {country: "Spain"}, outputs: "Madrid"},
    "span-c": {inputs: {country: "Peru"}, outputs: "Lima"},
}

const CHAT_SPANS = {
    "span-chat-a": {
        inputs: {
            topic: "tides",
            messages: [{role: "user", content: "Why are there two tides a day?"}],
        },
        outputs: {role: "assistant", content: "The moon pulls on both sides of the earth."},
    },
    "span-chat-b": {
        inputs: {
            topic: "seasons",
            messages: [{role: "user", content: "What causes the seasons?"}],
        },
        outputs: {role: "assistant", content: "The tilt of the earth's axis."},
    },
}

const MIXED_SPANS = {
    "span-a": COMPLETION_SPANS["span-a"],
    "span-chat-a": CHAT_SPANS["span-chat-a"],
}

type SpanSet = Record<string, Record<string, unknown>>

const spanFixtures = (scope: StoryScope, spans: SpanSet) =>
    Object.entries(spans).map(
        ([id, data]) =>
            [
                ["span", scope.projectId, id],
                {trace_id: `trace-${id}`, span_id: id, attributes: {ag: {data}}},
            ] as [string[], unknown],
    )

const baseFixtures = (scope: StoryScope, spans: SpanSet, extra: [unknown[], unknown][] = []) => [
    [projectPermissionQueryKey(scope.projectId, "view_spans"), true] as [unknown[], unknown],
    [
        ["testsets-list", scope.projectId, ""],
        {
            testsets: [
                {id: "ts-capitals", name: "Capital cities"},
                {id: "ts-support", name: "Support replies"},
            ],
            count: 2,
        },
    ] as [unknown[], unknown],
    [
        ["add-to-testset-columns", scope.projectId, "ts-capitals"],
        {keys: ["inputs", "expected"], hasRows: true},
    ] as [unknown[], unknown],
    ...spanFixtures(scope, spans),
    ...extra,
]

/** Marks the span query as failed before the sheet mounts, as after a failed request. */
const FailedSpans = ({spanIds}: {spanIds: string[]}) => {
    const client = useQueryClient()
    const projectId = useAtomValue(projectIdAtom)
    useState(() => {
        for (const id of spanIds) {
            const query = client.getQueryCache().build(client, {queryKey: ["span", projectId, id]})
            query.setState({
                ...query.state,
                status: "error",
                error: new Error("The span request failed"),
                errorUpdatedAt: Date.now(),
                fetchStatus: "idle",
            })
        }
        return null
    })
    return <AddToTestsetSheet spanIds={spanIds} onClose={() => undefined} />
}

const meta = {
    title: "@agenta/mobile/Developer/Observability/AddToTestsetSheet",
    component: AddToTestsetSheet,
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "The add to test set sheet from web/mobile, over the real form hook with seeded queries.",
            },
        },
    },
    args: {spanIds: Object.keys(COMPLETION_SPANS), onClose: () => undefined},
} satisfies Meta<typeof AddToTestsetSheet>

export default meta
type Story = StoryObj<typeof meta>

const pickTarget = async (canvasElement: HTMLElement, option: string) => {
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(await screen.findByRole("combobox", {name: "Test set"}))
    await userEvent.click(await screen.findByRole("option", {name: option}))
    return screen
}

export const Loading: Story = {
    parameters: {
        agenta: {
            // Without the view_spans answer the span queries never start.
            queries: (scope: StoryScope) => [
                [projectPermissionQueryKey(scope.projectId, "view_spans"), false],
            ],
        },
    },
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        await expect(await screen.findByLabelText("Loading the spans")).toBeVisible()
    },
}

export const NoTarget: Story = {
    parameters: {agenta: {queries: (scope: StoryScope) => baseFixtures(scope, COMPLETION_SPANS)}},
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        await expect(await screen.findByText("3 spans selected")).toBeVisible()
        await expect(
            screen.getByText("Select a test set above to start mapping fields"),
        ).toBeVisible()
    },
}

export const NewTestset: Story = {
    parameters: {agenta: {queries: (scope: StoryScope) => baseFixtures(scope, COMPLETION_SPANS)}},
    play: async ({canvasElement}) => {
        const screen = await pickTarget(canvasElement, "Create New")
        await userEvent.type(await screen.findByLabelText("Test set name"), "Capital cities v2")
        await expect(screen.getByRole("button", {name: "Create"})).toBeEnabled()
        await expect(screen.getByText("3. Preview test cases")).toBeVisible()
    },
}

export const ExistingTestset: Story = {
    parameters: {agenta: {queries: (scope: StoryScope) => baseFixtures(scope, COMPLETION_SPANS)}},
    play: async ({canvasElement}) => {
        const screen = await pickTarget(canvasElement, "Capital cities")
        await expect(await screen.findByRole("button", {name: "Commit"})).toBeEnabled()
    },
}

export const NewColumnsConfirm: Story = {
    parameters: {agenta: {queries: (scope: StoryScope) => baseFixtures(scope, COMPLETION_SPANS)}},
    play: async ({canvasElement}) => {
        const screen = await pickTarget(canvasElement, "Capital cities")
        await userEvent.click(await screen.findByRole("button", {name: "Commit"}))
        await expect(await screen.findByText("Add new columns to test set")).toBeVisible()
    },
}

export const DuplicateColumns: Story = {
    parameters: {agenta: {queries: (scope: StoryScope) => baseFixtures(scope, COMPLETION_SPANS)}},
    play: async ({canvasElement}) => {
        const screen = await pickTarget(canvasElement, "Create New")
        const second = await screen.findByLabelText("Column name 2")
        await userEvent.clear(second)
        await userEvent.type(second, "inputs")
        await expect(
            await screen.findByText("Duplicate columns detected. Ensure each column is unique."),
        ).toBeVisible()
    },
}

export const DifferentStructure: Story = {
    args: {spanIds: Object.keys(MIXED_SPANS)},
    parameters: {agenta: {queries: (scope: StoryScope) => baseFixtures(scope, MIXED_SPANS)}},
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        await expect(
            await screen.findByText(
                "Some of the selected spans have a different structure than the others.",
            ),
        ).toBeVisible()
    },
}

export const ChatSpans: Story = {
    args: {spanIds: Object.keys(CHAT_SPANS)},
    parameters: {agenta: {queries: (scope: StoryScope) => baseFixtures(scope, CHAT_SPANS)}},
    play: async ({canvasElement}) => {
        const screen = await pickTarget(canvasElement, "Create New")
        await expect(await screen.findByDisplayValue("messages")).toBeVisible()
    },
}

export const ColumnsLoadError: Story = {
    parameters: {
        agenta: {
            queries: (scope: StoryScope) =>
                baseFixtures(scope, COMPLETION_SPANS).filter(
                    ([key]) => key[0] !== "add-to-testset-columns",
                ),
        },
    },
    play: async ({canvasElement}) => {
        const screen = await pickTarget(canvasElement, "Capital cities")
        await expect(
            await screen.findByText("Couldn't load the test set columns", {}, {timeout: 10000}),
        ).toBeVisible()
    },
}

export const SpanLoadError: Story = {
    args: {spanIds: ["span-missing"]},
    parameters: {
        agenta: {
            // view_spans false keeps the failed query from fetching again on mount.
            queries: (scope: StoryScope) => [
                [projectPermissionQueryKey(scope.projectId, "view_spans"), false],
            ],
        },
    },
    render: (args) => <FailedSpans spanIds={[...args.spanIds]} />,
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        await expect(await screen.findByText("Couldn't load the selected spans")).toBeVisible()
        await expect(screen.getByRole("button", {name: "Try again"})).toBeVisible()
    },
}
