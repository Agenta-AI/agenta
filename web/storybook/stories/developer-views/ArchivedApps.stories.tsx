import {LoadError} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, userEvent, within} from "storybook/test"

import {ArchivedAppsTable} from "../../../mobile/src/features/archived-apps/ArchivedAppsTable"
import type {ArchivedAppRow} from "../../../mobile/src/features/archived-apps/archivedAppsView"
import {ArchivedAppsEmpty} from "../../../mobile/src/features/archived-apps/states/ArchivedAppsEmpty"

// The archived apps page body: the table and its states. The page shell (nav, back arrow, search)
// belongs to the mobile app and is not drawn here.
const ROWS: ArchivedAppRow[] = [
    {
        id: "app-1",
        name: "Support triage",
        createdAt: "2026-08-12T09:30:00Z",
        archivedAt: "2026-10-28T14:05:00Z",
        archivedById: null,
    },
    {
        id: "app-2",
        name: "Release notes writer",
        createdAt: "2026-07-02T11:00:00Z",
        archivedAt: "2026-10-14T08:20:00Z",
        archivedById: null,
    },
    {
        id: "app-3",
        name: "Invoice extractor with a long name that has to truncate in a narrow column",
        createdAt: "2026-05-19T16:45:00Z",
        archivedAt: "2026-09-30T10:10:00Z",
        archivedById: null,
    },
]

const meta = {
    title: "@agenta/mobile/Developer/ArchivedApps",
    component: ArchivedAppsTable,
    parameters: {layout: "padded"},
    args: {
        rows: ROWS,
        projectId: "story-project",
        canRestore: true,
        isLoading: false,
        empty: <ArchivedAppsEmpty />,
    },
} satisfies Meta<typeof ArchivedAppsTable>

export default meta
type Story = StoryObj<typeof meta>

export const Filled: Story = {
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        const [menu] = await canvas.findAllByRole("button", {name: "App actions"})
        await userEvent.click(menu)
        const body = within(canvasElement.ownerDocument.body)
        await expect(await body.findByRole("menuitem", {name: "Restore"})).toBeVisible()
    },
}

export const Loading: Story = {args: {rows: [], isLoading: true}}

export const Empty: Story = {args: {rows: []}}

export const NoMatch: Story = {
    args: {rows: [], empty: <ArchivedAppsEmpty term="invoice" onClear={() => undefined} />},
}

/** A viewer without `edit_workflows` can read the list but has no Restore. */
export const ReadOnly: Story = {args: {canRestore: false}}

/** The page replaces the table with this when the load fails. */
export const LoadFailed: Story = {
    render: () => (
        <LoadError framed title="Could not load archived apps" onRetry={() => undefined} />
    ),
}
