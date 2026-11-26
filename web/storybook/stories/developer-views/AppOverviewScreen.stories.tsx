import type {AppEnvironmentDeployment} from "@agenta/entities/environment"
import {setUserAtoms} from "@agenta/entities/shared/user"
import {LoadError} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import {DotsThreeVertical} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {atom} from "jotai"

import {AppOverviewSkeleton} from "../../../mobile/src/features/app-overview/states/AppOverviewSkeleton"
import {AppTitleSkeleton} from "../../../mobile/src/features/app-overview/states/AppTitleSkeleton"
import {SectionTitle} from "../../../mobile/src/features/app-overview/states/SectionTitle"
import {EvaluationRunsTable} from "../../../mobile/src/features/evaluations/list/EvaluationRunsTable"
import {EvaluationsEmpty} from "../../../mobile/src/features/evaluations/list/states/EvaluationsEmpty"
import type {RunRowActions} from "../../../mobile/src/features/evaluations/list/useRunRowActions"
import {EnvironmentCards} from "../../../mobile/src/features/variants/EnvironmentCards"
import {VariantsEmpty} from "../../../mobile/src/features/variants/states/VariantsEmpty"
import type {AppRevisionRow} from "../../../mobile/src/features/variants/useAppRevisions"
import {VariantsTable} from "../../../mobile/src/features/variants/VariantsTable"
import {toRevisionGroups} from "../../../mobile/src/features/variants/variantsView"
import type {
    AgentaDataParameters,
    QueryFixtures,
    StoryScope,
} from "../../.storybook/decorators/withAgentaData"

/**
 * The app overview page body: the title row, the deployment cards, the newest prompts, and the
 * newest auto and human evaluations. The real screen reads these from the API. Here each part
 * takes its rows as props, so the stories need no requests. The usage charts are not part of
 * the page yet.
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

const ACTIONS: RunRowActions = {
    canEdit: true,
    testsetsViewOn: true,
    open: noop,
    copyId: async () => undefined,
    toggleLive: async () => undefined,
    viewVariant: noop,
    viewTestset: noop,
    remove: noop,
    isBusy: () => false,
    modal: <></>,
}

const env = (name: string, deployed: boolean): AppEnvironmentDeployment => ({
    name,
    slug: name,
    deployedVariantId: deployed ? "v-main" : null,
    deployedRevisionId: deployed ? "rev-3" : null,
    deployedVariantName: deployed ? "Main" : null,
    revision: deployed ? "3" : null,
    updatedAt: deployed ? "2026-10-04T10:00:00Z" : null,
})

const ENVIRONMENTS = [env("development", true), env("staging", true), env("production", false)]

const revision = (version: number): AppRevisionRow => ({
    revisionId: `rev-${version}`,
    workflowId: "app-1",
    variantId: "v-main",
    variantName: "Main",
    variantSlug: "invoice-helper.main",
    version,
    model: "gpt-4o-mini",
    message: version % 2 ? "Lower the temperature" : null,
    createdAt: `2026-10-0${version}T10:00:00Z`,
    createdById: version % 2 ? ME.id : "user-sam",
})

const REVISIONS = [5, 4, 3, 2, 1].map(revision)

const run = (
    scope: StoryScope,
    key: string,
    name: string,
    status: string,
    kind: "auto" | "human",
) => ({
    id: scope.id(key),
    name,
    status,
    flags: {is_live: false, is_active: false, is_closed: false},
    created_at: "2026-10-28T14:05:00Z",
    created_by_id: ME.id,
    data: {
        steps: [
            {
                key: "input",
                type: "input" as const,
                origin: "auto" as const,
                references: {
                    application: {id: scope.id("app")},
                    application_revision: {id: scope.id("app-rev")},
                    testset: {id: scope.id("refunds")},
                },
            },
            {key: "annotation", type: "annotation" as const, origin: kind},
        ],
    },
})

const queries = (scope: StoryScope): QueryFixtures => [
    [
        ["workflows", "apps", "list", scope.projectId],
        {
            count: 1,
            refs: [
                {id: scope.id("app"), name: "Invoice helper", slug: "invoice-helper", flags: {}},
            ],
        },
    ],
    [
        ["testset", scope.projectId, scope.id("refunds")],
        {id: scope.id("refunds"), name: "Refund requests"},
    ],
    [["environments-list", scope.projectId, false], {count: 0, environments: []}],
]

const filledData: AgentaDataParameters = {
    queries,
    args: (scope: StoryScope) => ({
        autoRuns: [
            run(scope, "a1", "Prompt v3 against v2", "running", "auto"),
            run(scope, "a2", "Regression check", "success", "auto"),
        ],
        humanRuns: [run(scope, "h1", "Tone review with the team", "success", "human")],
    }),
}

type Run = ReturnType<typeof run>

interface DemoProps {
    title: string | null
    state: "filled" | "empty" | "failed"
    autoRuns?: Run[]
    humanRuns?: Run[]
}

const Header = ({title}: {title: string | null}) => (
    <div className="mb-6 flex min-w-0 flex-wrap items-center gap-2">
        {title === null ? (
            <div className="flex-1">
                <AppTitleSkeleton />
            </div>
        ) : (
            <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px]">
                {title}
            </h1>
        )}
        <Button type="button" size="icon-sm" variant="ghost" aria-label="App actions">
            <DotsThreeVertical aria-hidden className="size-4" weight="bold" />
        </Button>
    </div>
)

const Demo = ({title, state, autoRuns = [], humanRuns = []}: DemoProps) => {
    const failed = state === "failed"
    const empty = state === "empty"
    return (
        <div className="app-overview-story mx-auto max-w-5xl p-4 text-foreground">
            <style>
                {".app-overview-story, .app-overview-story * { box-sizing: border-box; }"}
            </style>
            <Header title={title} />
            {title === null ? (
                <AppOverviewSkeleton />
            ) : (
                <div className="flex flex-col gap-8">
                    <section>
                        <SectionTitle title="Deployment" />
                        <EnvironmentCards
                            environments={ENVIRONMENTS}
                            getHref={(environment) => `#${environment.slug}`}
                        />
                    </section>
                    <section>
                        <SectionTitle
                            title="Recent Prompts"
                            action={
                                <span className="text-sm text-muted-foreground">
                                    View all prompts →
                                </span>
                            }
                        />
                        {failed ? (
                            <LoadError framed title="Could not load variants" onRetry={noop} />
                        ) : (
                            <VariantsTable
                                groups={toRevisionGroups(empty ? [] : REVISIONS, "revisions")}
                                isLoading={false}
                                latestRevisionId="rev-5"
                                canDeploy
                                canDelete={false}
                                collapsed={new Set()}
                                onCollapsedChange={noop}
                                onOpen={noop}
                                onDeploy={noop}
                                onDelete={noop}
                                empty={<VariantsEmpty />}
                            />
                        )}
                    </section>
                    {(["auto", "human"] as const).map((kind) => (
                        <section key={kind}>
                            <SectionTitle
                                title={
                                    kind === "auto" ? "Auto Evaluations →" : "Human Evaluations →"
                                }
                            />
                            {failed ? (
                                <LoadError
                                    framed
                                    title="Could not load evaluations"
                                    onRetry={noop}
                                />
                            ) : (
                                <EvaluationRunsTable
                                    runs={empty ? [] : kind === "auto" ? autoRuns : humanRuns}
                                    isLoading={false}
                                    scope="app"
                                    actions={ACTIONS}
                                    empty={<EvaluationsEmpty kind={kind} />}
                                />
                            )}
                        </section>
                    ))}
                </div>
            )}
        </div>
    )
}

const meta = {
    title: "@agenta/mobile/Developer/AppOverview/AppOverviewScreen",
    component: Demo,
    parameters: {layout: "fullscreen", agenta: filledData},
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

export const Loading: Story = {args: {title: null, state: "filled"}}
export const FilledCompletionApp: Story = {args: {title: "Invoice helper", state: "filled"}}
export const FilledChatApp: Story = {args: {title: "Support chat assistant", state: "filled"}}
/** A new app: no deployment, and every table shows its designed empty state. */
export const NoActivity: Story = {args: {title: "Invoice helper", state: "empty"}}
/** Each section fails on its own with a retry, and the page stays up. */
export const SectionsFailed: Story = {args: {title: "Invoice helper", state: "failed"}}
export const Phone: Story = {
    args: {title: "Invoice helper", state: "filled"},
    globals: {viewport: {value: "mobile1", isRotated: false}},
}
