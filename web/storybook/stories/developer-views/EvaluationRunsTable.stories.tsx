import {setUserAtoms} from "@agenta/entities/shared/user"
import {ListTableToolbar} from "@agenta/ui/list-table"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {atom} from "jotai"
import {expect, userEvent, within} from "storybook/test"

import {
    CreateEvaluationMenu,
    type CreatableKind,
} from "../../../mobile/src/features/evaluations/list/CreateEvaluationMenu"
import {EvaluationKindTabs} from "../../../mobile/src/features/evaluations/list/EvaluationKindTabs"
import {EvaluationRunsTable} from "../../../mobile/src/features/evaluations/list/EvaluationRunsTable"
import {RunStatusFilter} from "../../../mobile/src/features/evaluations/list/RunStatusFilter"
import {EvaluationsEmpty} from "../../../mobile/src/features/evaluations/list/states/EvaluationsEmpty"
import {EvaluationsNoMatch} from "../../../mobile/src/features/evaluations/list/states/EvaluationsNoMatch"
import type {EvaluationKindTab} from "../../../mobile/src/features/evaluations/list/useEvaluationRunsFilters"
import type {RunRowActions} from "../../../mobile/src/features/evaluations/list/useRunRowActions"
import type {
    AgentaDataParameters,
    QueryFixtures,
    StoryScope,
} from "../../.storybook/decorators/withAgentaData"

/**
 * The evaluation runs page body: kind tabs, search row, and the runs table in its states. The
 * page shell (nav, app filter) belongs to the mobile app and is not drawn here. The table takes
 * its rows and actions as props, so the stories need no requests.
 */

const ME = {id: "user-me", username: "Alex", email: "me@example.com"}
setUserAtoms({
    currentUserAtom: atom(ME),
    membersAtom: atom([
        {user: ME},
        {user: {id: "user-sam", username: "Sam Lee", email: "sam@example.com"}},
    ]),
})

const noop = () => undefined

const makeActions = (canEdit: boolean): RunRowActions => ({
    canEdit,
    testsetsViewOn: true,
    open: noop,
    copyId: async () => undefined,
    toggleLive: async () => undefined,
    viewVariant: noop,
    viewTestset: noop,
    remove: noop,
    isBusy: () => false,
    modal: <></>,
})

type StepKind = "auto" | "human" | "custom"

interface RunFixture {
    key: string
    name: string | null
    status: string
    kind: StepKind
    live?: boolean
    active?: boolean
    createdAt: string
    createdById: string | null
    app: string
    testset: string
}

const FIXTURES: RunFixture[] = [
    {
        key: "r1",
        name: "Support triage v3 vs v2",
        status: "running",
        kind: "auto",
        createdAt: "2026-10-30T09:30:00Z",
        createdById: ME.id,
        app: "support",
        testset: "refunds",
    },
    {
        key: "r2",
        name: "Tone review with the team",
        status: "success",
        kind: "human",
        createdAt: "2026-10-28T14:05:00Z",
        createdById: "user-sam",
        app: "support",
        testset: "refunds",
    },
    {
        key: "r3",
        name: "Production traffic check",
        status: "running",
        kind: "auto",
        live: true,
        active: true,
        createdAt: "2026-10-20T08:20:00Z",
        createdById: ME.id,
        app: "notes",
        testset: "refunds",
    },
    {
        key: "r4",
        name: "Nightly regression from CI with a long name that has to truncate in a narrow column",
        status: "failure",
        kind: "custom",
        createdAt: "2026-10-14T03:00:00Z",
        createdById: null,
        app: "notes",
        testset: "regressions",
    },
    {
        key: "r5",
        name: null,
        status: "queued",
        kind: "auto",
        createdAt: "2026-10-12T17:45:00Z",
        createdById: "user-sam",
        app: "notes",
        testset: "regressions",
    },
    {
        key: "r6",
        name: "Early prompt comparison",
        status: "errors",
        kind: "auto",
        createdAt: "2026-09-30T10:10:00Z",
        createdById: ME.id,
        app: "support",
        testset: "regressions",
    },
]

const APPS = {support: "Support triage", notes: "Release notes writer"}
const TESTSETS = {refunds: "Refund requests", regressions: "Regression cases"}

const runsFor = (scope: StoryScope) =>
    FIXTURES.map((fixture) => ({
        id: scope.id(fixture.key),
        name: fixture.name,
        status: fixture.status,
        flags: {
            is_live: fixture.live ?? false,
            is_active: fixture.active ?? false,
            is_closed: false,
        },
        created_at: fixture.createdAt,
        created_by_id: fixture.createdById,
        data: {
            steps: [
                {
                    key: "input",
                    type: "input" as const,
                    origin: "auto" as const,
                    references: {
                        application: {id: scope.id(fixture.app)},
                        application_revision: {id: scope.id(`${fixture.app}-rev`)},
                        testset: {id: scope.id(fixture.testset)},
                    },
                },
                {
                    key: "annotation",
                    type: "annotation" as const,
                    origin: fixture.kind === "auto" ? ("auto" as const) : (fixture.kind as "human"),
                },
            ],
        },
    }))

// The app and test set columns read names from the query cache under the story's own project.
const queries = (scope: StoryScope): QueryFixtures => [
    [
        ["workflows", "apps", "list", scope.projectId],
        {
            count: 2,
            refs: Object.entries(APPS).map(([key, name]) => ({
                id: scope.id(key),
                name,
                slug: key,
                flags: {},
            })),
        },
    ],
    ...Object.entries(TESTSETS).map(([key, name]): [readonly unknown[], unknown] => [
        ["testset", scope.projectId, scope.id(key)],
        {id: scope.id(key), name},
    ]),
]

const filledData: AgentaDataParameters = {
    queries,
    args: (scope: StoryScope) => ({runs: runsFor(scope)}),
}

interface DemoProps {
    runs: ReturnType<typeof runsFor>
    tab?: EvaluationKindTab
    appScoped?: boolean
    loading?: boolean
    canEdit?: boolean
    state?: "rows" | "empty" | "noMatch"
}

const Demo = ({
    runs,
    tab = "all",
    appScoped = false,
    loading = false,
    canEdit = true,
    state = "rows",
}: DemoProps) => {
    const onCreate = (_kind: CreatableKind) => undefined
    const emptyBody =
        state === "noMatch" ? (
            <EvaluationsNoMatch onClear={noop} />
        ) : (
            <EvaluationsEmpty
                kind={tab}
                onCreate={canEdit ? onCreate : undefined}
                createMenu={
                    canEdit ? (
                        <CreateEvaluationMenu
                            tab="all"
                            onCreate={onCreate}
                            label="Start evaluation"
                        />
                    ) : null
                }
            />
        )
    return (
        <div className="evaluation-runs-story">
            <style>
                {".evaluation-runs-story, .evaluation-runs-story * { box-sizing: border-box; }"}
            </style>
            <div className="mb-3">
                <EvaluationKindTabs value={tab} appScoped={appScoped} onChange={noop} />
            </div>
            <ListTableToolbar
                search=""
                onSearchChange={noop}
                searchPlaceholder="Search evaluations"
                actions={
                    <>
                        <RunStatusFilter value={[]} onChange={noop} />
                        {canEdit ? <CreateEvaluationMenu tab={tab} onCreate={onCreate} /> : null}
                    </>
                }
            />
            <EvaluationRunsTable
                runs={state === "rows" ? runs : []}
                isLoading={loading}
                scope={appScoped ? "app" : "project"}
                actions={makeActions(canEdit)}
                empty={emptyBody}
            />
        </div>
    )
}

const meta = {
    title: "@agenta/mobile/Developer/Evaluations/EvaluationRunsTable",
    component: Demo,
    parameters: {layout: "padded"},
    args: {runs: []},
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

export const Loading: Story = {args: {loading: true}}

/** Every kind and status. Run 5 has no name, so it shows its id. */
export const Filled: Story = {parameters: {agenta: filledData}}

/** One app: no Application column and no Live tab. */
export const AppScope: Story = {parameters: {agenta: filledData}, args: {appScoped: true}}

/** Resize the canvas to 390 px: the table keeps Status, Name and the menu. */
export const Phone: Story = {parameters: {agenta: filledData}}

export const EmptyAll: Story = {args: {state: "empty"}}

export const EmptyHuman: Story = {args: {state: "empty", tab: "human"}}

export const EmptySdk: Story = {args: {state: "empty", tab: "custom"}}

export const NoMatch: Story = {args: {state: "noMatch"}}

/** A viewer without `edit_evaluation_runs` has no create button and no Stop or Delete. */
export const ReadOnly: Story = {parameters: {agenta: filledData}, args: {canEdit: false}}

export const CreateMenuOpen: Story = {
    parameters: {agenta: filledData},
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await userEvent.click(await canvas.findByRole("button", {name: /New evaluation/}))
        const body = within(canvasElement.ownerDocument.body)
        await expect(await body.findByRole("menuitem", {name: /Human evaluation/})).toBeVisible()
    },
}

export const LiveMenuOpen: Story = {
    parameters: {agenta: filledData},
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        const menus = await canvas.findAllByRole("button", {name: "Run actions"})
        await userEvent.click(menus[2])
        const body = within(canvasElement.ownerDocument.body)
        await expect(await body.findByRole("menuitem", {name: "Stop evaluation"})).toBeVisible()
    },
}
