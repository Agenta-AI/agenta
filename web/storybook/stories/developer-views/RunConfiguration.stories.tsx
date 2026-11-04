import {projectPermissionQueryKey} from "@agenta/entities/access"
import {
    evaluationRunQueryKey,
    runHeaderAtomFamily,
    type EvaluationRun,
} from "@agenta/entities/evaluationRun"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {useAtomValue} from "jotai"
import {expect, userEvent, within} from "storybook/test"

import {ConfigurationTab} from "../../../mobile/src/features/evaluation-run/configuration/ConfigurationTab"
import {EvaluatorsConfigSection} from "../../../mobile/src/features/evaluation-run/configuration/EvaluatorsConfigSection"
import {ConfigurationSkeleton} from "../../../mobile/src/features/evaluation-run/configuration/states/ConfigurationSkeleton"
import type {AgentaDataParameters, StoryScope} from "../../.storybook/decorators/withAgentaData"

/** The Configuration tab without the app shell, reading seeded queries. */
const ConfigurationStory = ({projectId, runId}: {projectId: string; runId: string}) => {
    const header = useAtomValue(runHeaderAtomFamily(runId))
    if (!header) return null
    return (
        <div className="text-foreground">
            <ConfigurationTab projectId={projectId} runId={runId} header={header} />
        </div>
    )
}

const meta = {
    title: "@agenta/mobile/Developer/Evaluations/RunConfiguration",
    component: ConfigurationStory,
    parameters: {layout: "padded"},
    args: {projectId: "", runId: ""},
} satisfies Meta<typeof ConfigurationStory>

export default meta
type Story = StoryObj<typeof meta>

interface Options {
    run?: Partial<EvaluationRun>
    testset?: boolean
    custom?: boolean
    /** Evaluator steps: with a revision reference, without one (shows "Latest"), or none. */
    evaluators?: "referenced" | "latest" | "none"
    canEdit?: boolean
}

function runFor(scope: StoryScope, options: Options): EvaluationRun {
    const id = scope.id("run")
    const evaluatorReference =
        options.evaluators === "latest"
            ? {evaluator: {id: scope.id("ev"), slug: "exact-match"}}
            : {
                  evaluator: {id: scope.id("ev"), slug: "exact-match"},
                  evaluator_revision: {id: scope.id("ev-rev"), version: 4},
              }
    return {
        id,
        name: "Capitals check",
        description: "Checks that the app names the right capital city.",
        status: "evaluation_finished",
        flags: {is_live: false, is_active: false, is_closed: false},
        created_at: "2026-10-30T09:00:00Z",
        updated_at: "2026-10-30T09:30:00Z",
        created_by_id: "user-1",
        data: {
            steps: [
                ...(options.testset === false
                    ? []
                    : [
                          {
                              key: "testset-capitals",
                              type: "input" as const,
                              references: {
                                  testset: {id: scope.id("ts"), slug: "capitals"},
                                  testset_revision: {id: scope.id("ts-rev")},
                              },
                          },
                      ]),
                {
                    key: "application-geo",
                    type: "invocation" as const,
                    references: {
                        application: {id: scope.id("app"), slug: "geography-bot"},
                        application_revision: {id: scope.id("app-rev"), version: 3},
                    },
                },
                ...(options.evaluators === "none"
                    ? []
                    : [
                          {
                              key: "evaluator-exact",
                              type: "annotation" as const,
                              origin: "auto" as const,
                              references: evaluatorReference,
                          },
                      ]),
            ],
        },
        ...options.run,
    }
}

/** Seeds the run, its test set, app and evaluator, and the edit permission. */
const seeded = (options: Options = {}): AgentaDataParameters => ({
    args: (scope: StoryScope) => ({projectId: scope.projectId, runId: scope.id("run")}),
    queries: (scope: StoryScope) => {
        const p = scope.projectId
        const appRevision = {
            id: scope.id("app-rev"),
            version: 3,
            workflow_id: scope.id("app"),
            workflow_variant_id: scope.id("app-var"),
            flags: options.custom ? {is_custom: true} : {is_application: true},
            data: {
                uri: "agenta:builtin:completion:v0",
                parameters: {
                    prompt: {
                        messages: [{role: "system", content: "Name the capital of the country."}],
                        llm_config: {model: "gpt-4o-mini", temperature: 0.2},
                    },
                },
                ...(options.custom
                    ? {}
                    : {schemas: {parameters: {type: "object", properties: {}}}}),
            },
        }
        const evaluatorRevision = {
            id: scope.id("ev-rev"),
            version: 4,
            workflow_id: scope.id("ev"),
            flags: {is_evaluator: true},
            data: {parameters: {correct_answer_key: "capital", case_sensitive: false}},
        }
        return [
            [evaluationRunQueryKey(scope.id("run")), runFor(scope, options)],
            [projectPermissionQueryKey(p, "edit_evaluation_runs"), options.canEdit !== false],
            [
                ["testset", p, scope.id("ts")],
                {
                    id: scope.id("ts"),
                    name: "Capitals",
                    description: "Countries and their capital cities.",
                },
            ],
            [
                ["revision", p, scope.id("ts-rev")],
                {
                    id: scope.id("ts-rev"),
                    testset_id: scope.id("ts"),
                    version: 2,
                    data: {testcase_ids: ["a", "b", "c", "d", "e", "f", "g", "h"]},
                },
            ],
            [
                ["revision-with-testcases", p, scope.id("ts-rev")],
                {
                    id: scope.id("ts-rev"),
                    testset_id: scope.id("ts"),
                    version: 2,
                    data: {
                        testcase_ids: [],
                        testcases: [{data: {country: "France", capital: "Paris"}}],
                    },
                },
            ],
            [
                ["workflows", "artifact", scope.id("app"), p],
                {id: scope.id("app"), name: "Geography bot"},
            ],
            [["workflows", "revision", scope.id("app-rev"), p], appRevision],
            [
                ["workflows", "variants", scope.id("app"), p],
                {count: 1, workflow_variants: [{id: scope.id("app-var"), name: "default"}]},
            ],
            [
                ["workflows", "artifact", scope.id("ev"), p],
                {
                    id: scope.id("ev"),
                    name: "Exact match",
                    description: "Checks that the answer equals the expected one.",
                },
            ],
            [["workflows", "revision", scope.id("ev-rev"), p], evaluatorRevision],
            [["workflows", "latestRevision", scope.id("ev"), p], evaluatorRevision],
        ]
    },
})

export const Loading: Story = {render: () => <ConfigurationSkeleton />}

export const Summary: Story = {parameters: {agenta: seeded()}}

export const SummaryWithTags: Story = {
    parameters: {agenta: seeded({run: {tags: ["geography", "weekly", "regression"]}})},
}

export const Editing: Story = {
    parameters: {agenta: seeded()},
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await userEvent.click(await canvas.findByRole("button", {name: "Edit"}))
        await expect(await canvas.findByPlaceholderText("Run name")).toBeVisible()
    },
}

export const ReadOnly: Story = {parameters: {agenta: seeded({canEdit: false})}}

export const AppAndTestset: Story = {parameters: {agenta: seeded()}}

export const CustomWorkflow: Story = {parameters: {agenta: seeded({custom: true})}}

export const NoTestset: Story = {parameters: {agenta: seeded({testset: false})}}

export const Evaluators: Story = {parameters: {agenta: seeded({evaluators: "referenced"})}}

export const EvaluatorLatest: Story = {parameters: {agenta: seeded({evaluators: "latest"})}}

export const NoEvaluators: Story = {parameters: {agenta: seeded({evaluators: "none"})}}

export const EvaluatorError: Story = {
    render: () => (
        <div className="text-foreground">
            <EvaluatorsConfigSection
                evaluators={[
                    {
                        key: "evaluator-exact",
                        name: "Exact match",
                        description: null,
                        version: 4,
                        latest: false,
                        revisionId: null,
                        settings: null,
                        snapshot: null,
                        pending: false,
                        failed: true,
                    },
                ]}
            />
        </div>
    ),
}

export const Phone: Story = {
    parameters: {agenta: seeded(), viewport: {defaultViewport: "mobile1"}},
}
