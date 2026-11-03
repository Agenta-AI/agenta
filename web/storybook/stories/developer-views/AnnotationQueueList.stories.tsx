import {useState} from "react"

import type {SimpleQueueTableRow} from "@agenta/entities/simpleQueue"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, userEvent, within} from "storybook/test"

import {
    QueueListContent,
    type QueueListContentProps,
} from "../../../mobile/src/features/annotations/QueueListContent"
import type {QueueKindFilter} from "../../../mobile/src/features/annotations/useQueueList"

const queue = (id: string, name: string, kind: "traces" | "testcases"): SimpleQueueTableRow =>
    ({
        id,
        key: id,
        name,
        description: "Review replies for tone and accuracy",
        run_id: `run-${id}`,
        status: "pending",
        data: {kind},
        created_by_id: "user-1",
        created_at: "2026-10-01T10:00:00Z",
        updated_at: "2026-10-02T10:00:00Z",
    }) as SimpleQueueTableRow

const ROWS = [
    queue("q-1", "Support replies", "traces"),
    queue("q-2", "Refund disputes", "traces"),
    queue("q-3", "Regression cases", "testcases"),
]

const BASE = "/w/workspace-1/p/project-1"

/** The list body with local search and filter state. The real screen reads them from atoms. */
const Frame = (props: Partial<QueueListContentProps>) => {
    const [search, setSearch] = useState(props.search ?? "")
    const [kind, setKind] = useState<QueueKindFilter>(props.kind ?? null)
    return (
        <div className="mx-auto max-w-[1100px] p-4">
            <QueueListContent
                rows={ROWS}
                base={BASE}
                isLoading={false}
                isError={false}
                hasMore={false}
                isLoadingMore={false}
                canEdit
                appliedSearch={search}
                onClearSearch={() => setSearch("")}
                onLoadMore={() => undefined}
                onRetry={() => undefined}
                onCreate={() => undefined}
                onDelete={() => undefined}
                {...props}
                search={search}
                kind={kind}
                onSearchChange={setSearch}
                onKindChange={setKind}
            />
        </div>
    )
}

const meta = {
    title: "@agenta/mobile/Developer/AnnotationQueues/QueueListScreen",
    component: Frame,
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "The annotation queues list from web/mobile, drawn without its data hooks. The Reviewed and Status cells read the live queue store, so they show their loading and fallback values here.",
            },
        },
    },
} satisfies Meta<typeof Frame>

export default meta
type Story = StoryObj<typeof meta>

export const Loading: Story = {args: {rows: [], isLoading: true}}

export const FirstRun: Story = {
    args: {rows: []},
    play: async ({canvasElement}) => {
        const screen = within(canvasElement)
        await expect(await screen.findByText("Create your first annotation queue")).toBeVisible()
    },
}

export const Filled: Story = {
    play: async ({canvasElement}) => {
        const screen = within(canvasElement)
        await expect(await screen.findByText("Support replies")).toBeVisible()
        // Open a row menu.
        const menus = screen.getAllByRole("button", {name: /actions|more|menu/i})
        await userEvent.click(menus[0])
        const body = within(canvasElement.ownerDocument.body)
        await expect(await body.findByText("Copy ID")).toBeVisible()
    },
}

export const SearchNoMatch: Story = {
    args: {rows: []},
    play: async ({canvasElement}) => {
        const screen = within(canvasElement)
        await userEvent.type(screen.getByPlaceholderText("Search queues"), "billing")
        await expect(await screen.findByText("No queues match your search")).toBeVisible()
        await expect(screen.getByText(/No annotation queues matched "billing"/)).toBeVisible()
    },
}

export const FilterNoMatch: Story = {
    args: {rows: [], kind: "testcases"},
    play: async ({canvasElement}) => {
        const screen = within(canvasElement)
        await expect(await screen.findByText("No queues match your filters")).toBeVisible()
        await expect(screen.getByRole("button", {name: "Clear filter"})).toBeVisible()
    },
}

export const LoadError: Story = {args: {rows: [], isError: true}}

export const ReadOnly: Story = {args: {canEdit: false}}
