import {evaluationRunQueryKey, type EvaluationRun} from "@agenta/entities/evaluationRun"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {ScenarioFocusSheet} from "../../../mobile/src/features/evaluation-run/focus/ScenarioFocusSheet"
import type {ScenarioRowData} from "../../../mobile/src/features/evaluation-run/scenarios/scenarioColumns"
import {runScenariosQueryKey} from "../../../mobile/src/features/evaluation-run/scenarios/useRunScenarios"
import type {AgentaDataParameters, StoryScope} from "../../.storybook/decorators/withAgentaData"

const OUTPATH = "attributes.ag.data.outputs"

const FocusStory = ({runId, human}: {runId: string; human?: boolean}) => (
    <div className="text-foreground">
        <ScenarioFocusSheet
            runId={runId}
            poll
            header={{
                name: "Capitals check",
                description: null,
                status: "running",
                kind: human ? "human" : "auto",
                flags: {isLive: false, isClosed: false, isActive: true},
                createdAt: null,
                updatedAt: null,
                createdById: null,
            }}
        />
    </div>
)

const meta = {
    title: "@agenta/mobile/Developer/Evaluations/ScenarioFocus",
    component: FocusStory,
    parameters: {
        layout: "fullscreen",
        nextjs: {router: {query: {focusScenarioId: "sc-2", focusRunId: "run"}}},
    },
    args: {runId: ""},
} satisfies Meta<typeof FocusStory>

export default meta
type Story = StoryObj<typeof meta>

const flag = (value: boolean) => ({type: "binary", count: 1, freq: [{value, count: 1}]})

function runFor(id: string): EvaluationRun {
    return {
        id,
        name: "Capitals check",
        status: "running",
        flags: {is_live: false, is_active: true, is_closed: false},
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
                    column: {kind: "invocation", name: "answer"},
                    step: {key: "application-geo", path: OUTPATH},
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

interface RowSpec {
    status?: string
    invocationStatus?: string
    answer?: unknown
}

function row(
    position: number,
    {status = "success", invocationStatus, answer}: RowSpec,
): ScenarioRowData {
    const done = status === "success"
    return {
        scenario: {id: `sc-${position}`, run_id: "run", status},
        valuesFailed: false,
        invocation: {
            traceId: done ? `trace-${position}` : null,
            status: invocationStatus ?? status,
        },
        cells: {
            "testset:capitals": [
                {
                    name: "question",
                    kind: "testset",
                    path: "data.question",
                    value: "What is the capital of Japan?",
                },
            ],
            "application:geography-bot": [
                {
                    name: "answer",
                    kind: "application",
                    path: OUTPATH,
                    value: done ? (answer ?? "Tokyo") : undefined,
                },
            ],
            "evaluator:exact-match": [
                {
                    name: "success",
                    kind: "evaluator",
                    path: `${OUTPATH}.success`,
                    value: done ? flag(true) : undefined,
                },
                {
                    name: "score",
                    kind: "evaluator",
                    path: `${OUTPATH}.score`,
                    value: done ? {type: "numeric/continuous", count: 1, mean: 0.88} : undefined,
                },
            ],
        },
    }
}

const seeded = (focused: RowSpec, hasNext = false): AgentaDataParameters => ({
    args: (scope: StoryScope) => ({runId: scope.id("run")}),
    queries: (scope: StoryScope) => {
        const runId = scope.id("run")
        return [
            [evaluationRunQueryKey(runId), runFor(runId)],
            [
                runScenariosQueryKey(scope.projectId, runId),
                {
                    pages: [
                        {
                            cursor: null,
                            nextCursor: hasNext ? "next" : null,
                            rows: [row(1, {}), row(2, focused), row(3, {})],
                        },
                    ],
                    pageParams: [null],
                },
            ],
        ]
    },
})

export const AutoScenario: Story = {parameters: {agenta: seeded({})}}

export const ChatOutput: Story = {
    parameters: {
        agenta: seeded({
            answer: [{role: "assistant", content: "The capital of Japan is Tokyo."}],
        }),
    },
}

export const RunningStep: Story = {parameters: {agenta: seeded({status: "running"})}}

export const FailedInvocation: Story = {
    parameters: {agenta: seeded({status: "failure"})},
}

export const NotFound: Story = {
    parameters: {
        agenta: seeded({}),
        nextjs: {router: {query: {focusScenarioId: "sc-404", focusRunId: "run"}}},
    },
}

export const Phone: Story = {
    parameters: {agenta: seeded({}, true), viewport: {defaultViewport: "mobile1"}},
}

export const Dark: Story = {globals: {theme: "dark"}, parameters: {agenta: seeded({})}}
