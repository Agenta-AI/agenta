import {setUserAtoms} from "@agenta/entities/shared/user"
import {LoadError} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {atom} from "jotai"
import {expect, userEvent, within} from "storybook/test"

import {ArchivedAppsTable} from "../../../mobile/src/features/archived-apps/ArchivedAppsTable"
import type {ArchivedAppRow} from "../../../mobile/src/features/archived-apps/archivedAppsView"
import {ArchivedAppsEmpty} from "../../../mobile/src/features/archived-apps/states/ArchivedAppsEmpty"
import type {
    AgentaDataParameters,
    QueryFixtures,
    StoryScope,
} from "../../.storybook/decorators/withAgentaData"

// The archived apps page body: the table and its states. The page shell (nav, back arrow, search)
// belongs to the mobile app and is not drawn here.

// The members the "Archived By" column resolves names from, and the signed-in user ("(you)").
const ME = {id: "user-me", username: "Alex", email: "me@example.com"}
setUserAtoms({
    currentUserAtom: atom(ME),
    membersAtom: atom([
        {user: ME},
        {user: {id: "user-sam", username: "Sam Lee", email: "sam@example.com"}},
    ]),
})

type AppType = "chat" | "completion" | "custom"

const FIXTURES: {
    key: string
    name: string
    type: AppType
    createdAt: string
    archivedAt: string
    archivedById: string | null
}[] = [
    {
        key: "support",
        name: "Support triage",
        type: "chat",
        createdAt: "2026-08-12T09:30:00Z",
        archivedAt: "2026-10-28T14:05:00Z",
        archivedById: ME.id,
    },
    {
        key: "notes",
        name: "Release notes writer",
        type: "completion",
        createdAt: "2026-07-02T11:00:00Z",
        archivedAt: "2026-10-14T08:20:00Z",
        archivedById: "user-sam",
    },
    {
        key: "invoice",
        name: "Invoice extractor with a long name that has to truncate in a narrow column",
        type: "custom",
        createdAt: "2026-05-19T16:45:00Z",
        archivedAt: "2026-09-30T10:10:00Z",
        archivedById: null,
    },
]

// Ids are scoped per story, because the type column reads each app's latest revision from the
// query cache under the story's own project.
const rowsFor = (scope: StoryScope): ArchivedAppRow[] =>
    FIXTURES.map(({key, name, createdAt, archivedAt, archivedById}) => ({
        id: scope.id(key),
        name,
        createdAt,
        archivedAt,
        archivedById,
    }))

const revisionFor = (type: AppType) =>
    type === "custom"
        ? {data: {uri: "user:custom:story:latest"}, flags: {is_custom: true}}
        : {data: {uri: `agenta:builtin:${type}:v0`}, flags: {}}

const filledData: AgentaDataParameters = {
    queries: (scope: StoryScope): QueryFixtures =>
        FIXTURES.map(({key, type}) => [
            ["workflows", "latestRevision", scope.id(key), scope.projectId],
            {id: `rev-${scope.id(key)}`, ...revisionFor(type)},
        ]),
    args: (scope: StoryScope) => ({rows: rowsFor(scope), projectId: scope.projectId}),
}

const meta = {
    title: "@agenta/mobile/Developer/ArchivedApps",
    component: ArchivedAppsTable,
    parameters: {layout: "padded"},
    // Storybook's Tailwind has no preflight, so boxes are content-box there; the app's is
    // border-box. Without this the rows come out 24px wider than the header and drift.
    decorators: [
        (Story) => (
            <>
                <style>
                    {".archived-apps-story, .archived-apps-story * { box-sizing: border-box; }"}
                </style>
                <div className="archived-apps-story">
                    <Story />
                </div>
            </>
        ),
    ],
    args: {
        rows: [],
        projectId: "story-project",
        canRestore: true,
        isLoading: false,
        empty: <ArchivedAppsEmpty />,
    },
} satisfies Meta<typeof ArchivedAppsTable>

export default meta
type Story = StoryObj<typeof meta>

export const Filled: Story = {
    parameters: {agenta: filledData},
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        const [menu] = await canvas.findAllByRole("button", {name: "App actions"})
        await userEvent.click(menu)
        const body = within(canvasElement.ownerDocument.body)
        await expect(await body.findByRole("menuitem", {name: "Restore"})).toBeVisible()
    },
}

export const Loading: Story = {args: {isLoading: true}}

export const Empty: Story = {}

export const NoMatch: Story = {
    args: {empty: <ArchivedAppsEmpty term="invoice" onClear={() => undefined} />},
}

/** A viewer without `edit_workflows` can read the list but has no Restore. */
export const ReadOnly: Story = {args: {canRestore: false}, parameters: {agenta: filledData}}

/** The page replaces the table with this when the load fails. */
export const LoadFailed: Story = {
    render: () => (
        <LoadError framed title="Could not load archived apps" onRetry={() => undefined} />
    ),
}
