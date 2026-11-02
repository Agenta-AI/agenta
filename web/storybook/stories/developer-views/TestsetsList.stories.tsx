import {useState} from "react"

import {LoadError} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, userEvent, waitFor, within} from "storybook/test"

import {TestsetsEmpty} from "../../../mobile/src/features/testsets/list/states/TestsetsEmpty"
import {TestsetsNoMatch} from "../../../mobile/src/features/testsets/list/states/TestsetsNoMatch"
import type {TestsetRow} from "../../../mobile/src/features/testsets/list/testsetRowTypes"
import {
    TestsetsTable,
    type TestsetsTableProps,
} from "../../../mobile/src/features/testsets/list/TestsetsTable"

/**
 * The Developer view's testsets list, drawn from fixtures. The table holds no data layer, so each
 * story passes the rows and the verbs a screen would pass.
 */
const meta = {
    title: "@agenta/mobile/Developer/Testsets/List",
    component: TestsetsTable,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The testsets list: a flat table with Name, Commit Message, Created by and Date Created, a kebab per row, and Load more under it. Clone, Rename and Archive show only to a reader who may edit; the exports show only to one who may export.",
            },
        },
    },
} satisfies Meta<typeof TestsetsTable>

export default meta
type Story = StoryObj<typeof meta>

const NAMES = [
    "Refund questions",
    "Greeting checks",
    "Billing edge cases",
    "Tone review",
    "Shipping delays",
    "Language mix",
]

const ROWS: TestsetRow[] = NAMES.map((name, index) => ({
    id: `t${index}`,
    name,
    created_at: `2026-0${index + 1}-1${index}T10:00:00Z`,
    created_by_id: null,
}))

const COMMIT_MESSAGES = new Map<string, string | null>([
    ["t0", "Added cases for partial refunds"],
    ["t1", null],
    ["t2", "Fixed two wrong expected answers"],
    ["t3", "Removed duplicate rows"],
])

const base: TestsetsTableProps = {
    rows: ROWS,
    commitMessages: COMMIT_MESSAGES,
    isLoading: false,
    empty: null,
    hasMore: false,
    isLoadingMore: false,
    onLoadMore: () => undefined,
    canEdit: true,
    canExport: true,
    isBusy: () => false,
    isAnyBusy: false,
    onOpen: () => undefined,
    onExport: () => undefined,
    onArchive: async () => undefined,
    onClone: () => undefined,
    onRename: () => undefined,
}

export const Loading: Story = {args: {...base, rows: [], isLoading: true}}

export const Empty: Story = {
    args: {...base, rows: [], empty: <TestsetsEmpty onCreate={() => undefined} />},
}

export const NoMatch: Story = {
    args: {
        ...base,
        rows: [],
        empty: <TestsetsNoMatch term="zeta" onClear={() => undefined} />,
    },
}

export const Filled: Story = {
    args: base,
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getAllByRole("button", {name: "Testset actions"})[0])
        const body = within(canvasElement.ownerDocument.body)
        await userEvent.click(await body.findByRole("menuitem", {name: "Archive"}))
        await expect(await body.findByText("Archive this testset?")).toBeVisible()
        await userEvent.click(body.getByRole("button", {name: "Archive"}))
        await waitFor(() => expect(body.queryByText("Archive this testset?")).toBeNull())
    },
}

/** Adds the next page when Load more is pressed, as the screen does. */
const MorePages = (args: TestsetsTableProps) => {
    const [count, setCount] = useState(3)
    return (
        <TestsetsTable
            {...args}
            rows={ROWS.slice(0, count)}
            hasMore={count < ROWS.length}
            onLoadMore={() => setCount(ROWS.length)}
        />
    )
}

export const FilledMorePages: Story = {args: base, render: (args) => <MorePages {...args} />}

export const ReadOnly: Story = {args: {...base, canEdit: false, canExport: false}}

export const LoadFailed: Story = {
    args: base,
    render: () => <LoadError framed title="Could not load testsets" onRetry={() => undefined} />,
}
