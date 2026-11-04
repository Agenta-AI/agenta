import {
    evaluationRunQueryKey,
    type EvaluationRun,
    type EvaluationRunScenario,
} from "@agenta/entities/evaluationRun"
import {LoadError} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {ScenarioRowData} from "../../../mobile/src/features/evaluation-run/scenarios/scenarioColumns"
import {ScenariosTab} from "../../../mobile/src/features/evaluation-run/scenarios/ScenariosTab"
import {ScenariosEmpty} from "../../../mobile/src/features/evaluation-run/scenarios/states/ScenariosEmpty"
import {ScenariosLoadMoreError} from "../../../mobile/src/features/evaluation-run/scenarios/states/ScenariosLoadMoreError"
import {ScenariosSkeleton} from "../../../mobile/src/features/evaluation-run/scenarios/states/ScenariosSkeleton"
import {runScenariosQueryKey} from "../../../mobile/src/features/evaluation-run/scenarios/useRunScenarios"
import type {AgentaDataParameters, StoryScope} from "../../.storybook/decorators/withAgentaData"

const ScenariosStory = ({runId}: {runId: string}) => (
    <div className="text-foreground">
        <ScenariosTab runId={runId} />
    </div>
)

const meta = {
    title: "@agenta/mobile/Developer/Evaluations/ScenariosTab",
    component: ScenariosStory,
    parameters: {layout: "padded"},
    args: {runId: ""},
} satisfies Meta<typeof ScenariosStory>

export default meta
type Story = StoryObj<typeof meta>

const OUTPATH = "attributes.ag.data.outputs"

const QUESTIONS = [
    ["What is the capital of France?", "Paris", true, 0.91],
    ["What is the capital of Japan?", "Tokyo", true, 0.88],
    ["What is the capital of Chile?", "Santiago", true, 0.84],
    ["What is the capital of Kenya?", "Mombasa", false, 0.32],
    ["What is the capital of Peru?", "Lima", true, 0.9],
    ["What is the capital of Norway?", "Oslo", true, 0.95],
    ["What is the capital of Canada?", "Toronto", false, 0.28],
    ["What is the capital of Egypt?", "Cairo", true, 0.87],
] as const

const flag = (value: boolean) => ({type: "binary", count: 1, freq: [{value, count: 1}]})

function runFor(id: string, live: boolean): EvaluationRun {
    return {
        id,
        name: live ? "Support replies (live)" : "Capitals check",
        status: "running",
        flags: {is_live: live, is_active: true, is_closed: false},
        data: {
            steps: [
                {
                    key: "testset-capitals",
                    type: "input",
                    references: {testset: {id: `${id}-ts`, slug: "capitals"}},
                },
                {
                    key: "application-geo",
                    type: "invocation",
                    references: {application: {id: `${id}-app`, slug: "geography-bot"}},
                },
                {
                    key: "evaluator-exact",
                    type: "annotation",
                    origin: "auto",
                    references: {evaluator: {id: `${id}-ev`, slug: "exact-match"}},
                },
            ],
            mappings: [
                {
                    column: {kind: "testset", name: "question"},
                    step: {key: "testset-capitals", path: "data.question"},
                },
                {
                    column: {kind: "testset", name: "expected"},
                    step: {key: "testset-capitals", path: "data.expected"},
                },
                {
                    column: {kind: "testset", name: "region"},
                    step: {key: "testset-capitals", path: "data.region"},
                },
                {
                    column: {kind: "invocation", name: "answer"},
                    step: {key: "application-geo", path: OUTPATH},
                },
                {
                    column: {kind: "invocation", name: "cost"},
                    step: {
                        key: "application-geo",
                        path: "attributes.ag.metrics.costs.cumulative.total",
                    },
                },
                {
                    column: {kind: "annotation", name: "success"},
                    step: {key: "evaluator-exact", path: `${OUTPATH}.success`},
                },
                {
                    column: {kind: "annotation", name: "score"},
                    step: {key: "evaluator-exact", path: `${OUTPATH}.score`},
                },
            ],
        },
    }
}

function rowFor(runId: string, position: number, status: string): ScenarioRowData {
    const [question, answer, success, score] = QUESTIONS[position % QUESTIONS.length]
    const scenario: EvaluationRunScenario = {id: `${runId}-sc-${position}`, run_id: runId, status}
    const done = status === "success"
    return {
        scenario,
        invocation: null,
        cells: {
            "testset:capitals": [
                {name: "question", kind: "testset", path: "data.question", value: question},
                {name: "expected", kind: "testset", path: "data.expected", value: answer},
                {name: "region", kind: "testset", path: "data.region", value: "Capital cities"},
            ],
            "application:geography-bot": [
                {
                    name: "answer",
                    kind: "application",
                    path: OUTPATH,
                    value: done ? answer : undefined,
                },
            ],
            "evaluator:exact-match": [
                {
                    name: "success",
                    kind: "evaluator",
                    path: `${OUTPATH}.success`,
                    value: done ? flag(success) : undefined,
                },
                {
                    name: "score",
                    kind: "evaluator",
                    path: `${OUTPATH}.score`,
                    value: done ? {type: "numeric/continuous", count: 1, mean: score} : undefined,
                },
            ],
            metrics: [
                {
                    name: "cost",
                    kind: "metrics",
                    path: "attributes.ag.metrics.costs.cumulative.total",
                    value: done ? 0.00042 : undefined,
                },
            ],
        },
    }
}

/** Seeds the run and the first page of scenarios into the query cache. */
const seeded = (
    statuses: string[],
    {live = false, hasNext = false}: {live?: boolean; hasNext?: boolean} = {},
): AgentaDataParameters => ({
    args: (scope: StoryScope) => ({runId: scope.id("run")}),
    queries: (scope: StoryScope) => {
        const runId = scope.id("run")
        return [
            [evaluationRunQueryKey(runId), runFor(runId, live)],
            [
                runScenariosQueryKey(scope.projectId, runId),
                {
                    pages: [
                        {
                            cursor: null,
                            nextCursor: hasNext ? "next" : null,
                            rows: statuses.map((status, position) =>
                                rowFor(runId, position, status),
                            ),
                        },
                    ],
                    pageParams: [null],
                },
            ],
        ]
    },
})

const FINISHED = Array.from({length: 8}, () => "success")

export const AutoFilled: Story = {parameters: {agenta: seeded(FINISHED)}}

export const Running: Story = {
    parameters: {
        agenta: seeded([
            "success",
            "success",
            "running",
            "running",
            "pending",
            "pending",
            "pending",
            "pending",
        ]),
    },
}

export const Online: Story = {
    parameters: {agenta: seeded(["success", "success", "failure", "success"], {live: true})},
}

export const Empty: Story = {parameters: {agenta: seeded([])}}

export const Loading: Story = {render: () => <ScenariosSkeleton />}

export const LoadErrorState: Story = {
    name: "LoadError",
    render: () => <LoadError framed title="Could not load scenarios" onRetry={() => undefined} />,
}

export const EmptyState: Story = {render: () => <ScenariosEmpty />}

export const LoadMoreError: Story = {
    render: () => <ScenariosLoadMoreError onRetry={() => undefined} />,
}

export const Phone: Story = {
    parameters: {agenta: seeded(FINISHED, {hasNext: true}), viewport: {defaultViewport: "mobile1"}},
}

export const Dark: Story = {
    globals: {theme: "dark"},
    parameters: {agenta: seeded(FINISHED)},
}
