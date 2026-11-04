import {setUserAtoms} from "@agenta/entities/shared/user"
import {LoadError} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {atom} from "jotai"
import {expect, userEvent, within} from "storybook/test"

import type {ArchivedTestsetRow} from "../../../mobile/src/features/testsets/archived/ArchivedTestsetRowCells"
import {
    ArchivedTestsetsTable,
    type ArchivedTestsetsTableProps,
} from "../../../mobile/src/features/testsets/archived/ArchivedTestsetsTable"
import {ArchivedTestsetsEmpty} from "../../../mobile/src/features/testsets/archived/states/ArchivedTestsetsEmpty"
import {TestsetsNoMatch} from "../../../mobile/src/features/testsets/list/states/TestsetsNoMatch"

// The members the Created by and Archived by columns resolve names from, and the signed-in user.
const ME = {id: "user-me", username: "Alex", email: "me@example.com"}
setUserAtoms({
    currentUserAtom: atom(ME),
    membersAtom: atom([
        {user: ME},
        {user: {id: "user-sam", username: "Sam Lee", email: "sam@example.com"}},
    ]),
})

/**
 * The archived test sets page body: the table and its states. The page shell (nav, back arrow,
 * search) belongs to the mobile app and is not drawn here.
 */
const meta = {
    title: "@agenta/mobile/Developer/Testsets/Archived",
    component: ArchivedTestsetsTable,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The archived test sets: Name, Date Created, Created by, Archived at and Archived by, with View details and Restore in each row's menu. Restore shows only to a reader who may edit test sets.",
            },
        },
    },
} satisfies Meta<typeof ArchivedTestsetsTable>

export default meta
type Story = StoryObj<typeof meta>

const ROWS: ArchivedTestsetRow[] = [
    {
        id: "t0",
        name: "Refund questions",
        created_at: "2026-08-12T09:30:00Z",
        created_by_id: ME.id,
        deleted_at: "2026-10-28T14:05:00Z",
        deleted_by_id: ME.id,
    },
    {
        id: "t1",
        name: "Greeting checks",
        created_at: "2026-07-02T11:00:00Z",
        created_by_id: "user-sam",
        deleted_at: "2026-10-14T08:20:00Z",
        deleted_by_id: "user-sam",
    },
    {
        id: "t2",
        name: "Shipping delays with a long name that has to truncate in a narrow column",
        created_at: "2026-05-19T16:45:00Z",
        created_by_id: null,
        deleted_at: "2026-09-30T10:10:00Z",
        deleted_by_id: null,
    },
]

const base: ArchivedTestsetsTableProps = {
    rows: ROWS,
    projectId: "story-project",
    isLoading: false,
    empty: <ArchivedTestsetsEmpty />,
    canRestore: true,
    isBusy: () => false,
    onOpen: () => undefined,
}

export const Loading: Story = {args: {...base, rows: [], isLoading: true}}

export const Empty: Story = {args: {...base, rows: []}}

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
        const [menu] = await canvas.findAllByRole("button", {name: "Test set actions"})
        await userEvent.click(menu)
        const body = within(canvasElement.ownerDocument.body)
        await expect(await body.findByRole("menuitem", {name: "Restore"})).toBeVisible()
    },
}

/** A reader without `edit_testsets` can read the list but has no Restore. */
export const ReadOnly: Story = {args: {...base, canRestore: false}}

/** The page replaces the table with this when the load fails. */
export const LoadFailed: Story = {
    args: base,
    render: () => (
        <LoadError framed title="Could not load archived test sets" onRetry={() => undefined} />
    ),
}
