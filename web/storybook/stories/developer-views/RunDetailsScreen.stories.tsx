import {projectPermissionQueryKey} from "@agenta/entities/access"
import {
    evaluationRunQueryKey,
    runLevelMetricsQueryKey,
    type EvaluationMetric,
    type EvaluationRun,
} from "@agenta/entities/evaluationRun"
import {LoadError} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {RunDetailsBody} from "../../../mobile/src/features/evaluation-run/RunDetailsBody"
import {RunDetailsHeader} from "../../../mobile/src/features/evaluation-run/RunDetailsHeader"
import {RunDetailsSkeleton} from "../../../mobile/src/features/evaluation-run/states/RunDetailsSkeleton"
import type {AgentaDataParameters, StoryScope} from "../../.storybook/decorators/withAgentaData"

/** The run page without the app shell: the title row and the body, reading seeded queries. */
const RunDetailsStory = ({projectId, runId}: {projectId: string; runId: string}) => (
    <div className="flex flex-col gap-4 text-foreground">
        <RunDetailsHeader projectId={projectId} runId={runId} />
        <RunDetailsBody runId={runId} />
    </div>
)

const meta = {
    title: "@agenta/mobile/Developer/Evaluations/RunDetailsScreen",
    component: RunDetailsStory,
    parameters: {layout: "padded"},
    args: {projectId: "", runId: ""},
} satisfies Meta<typeof RunDetailsStory>

export default meta
type Story = StoryObj<typeof meta>

type Kind = "auto" | "human" | "online"

const binary = (trueCount: number, falseCount: number) => ({
    type: "binary",
    count: trueCount + falseCount,
    freq: [
        {value: true, count: trueCount},
        {value: false, count: falseCount},
    ],
})
const numeric = (mean: number, min: number, max: number) => ({
    type: "numeric/continuous",
    count: 8,
    mean,
    min,
    max,
    hist: [
        {count: 3, interval: [min, mean]},
        {count: 5, interval: [mean, max]},
    ],
})

function runFor(id: string, kind: Kind, patch: Partial<EvaluationRun> = {}): EvaluationRun {
    const evaluator = {
        key: "evaluator-exact",
        type: "annotation" as const,
        origin: kind === "human" ? ("human" as const) : ("auto" as const),
        references: {evaluator: {id: `${id}-ev`, slug: "exact-match"}},
    }
    return {
        id,
        name: kind === "online" ? "Support replies (live)" : "Capitals check",
        status: kind === "auto" ? "success" : "running",
        flags: {is_live: kind === "online", is_active: kind !== "auto", is_closed: false},
        created_at: "2026-10-30T09:00:00Z",
        updated_at: "2026-10-30T09:30:00Z",
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
                    references: {
                        application: {id: `${id}-app`, slug: "geography-bot"},
                        application_revision: {id: `${id}-rev`, version: 3},
                    },
                },
                evaluator,
            ],
        },
        ...patch,
    }
}

function metricsFor(id: string, kind: Kind): EvaluationMetric[] {
    const app = {
        "attributes.ag.metrics.costs.cumulative.total": numeric(0.00042, 0.0001, 0.0009),
        "attributes.ag.metrics.duration.cumulative": numeric(1.84, 0.9, 3.2),
        "attributes.ag.metrics.tokens.cumulative.total": numeric(1250, 600, 2100),
        "attributes.ag.metrics.errors.cumulative": {type: "numeric/discrete", count: 8, sum: 1},
    }
    if (kind === "online") {
        return [0, 10, 20, 30].map((minute, index) => ({
            id: `${id}-m${index}`,
            run_id: id,
            scenario_id: null,
            timestamp: new Date(Date.UTC(2026, 9, 30, 9, minute)).toISOString(),
            data: {
                "evaluator-exact": {"attributes.ag.data.outputs.success": binary(index + 1, 2)},
                "application-geo": app,
            },
        }))
    }
    return [
        {
            id: `${id}-m`,
            run_id: id,
            scenario_id: null,
            data: {
                "evaluator-exact": {
                    "attributes.ag.data.outputs.success": binary(6, 2),
                    "attributes.ag.data.outputs.score": numeric(0.72, 0.2, 1),
                },
                "application-geo": app,
            },
        },
    ]
}

/** Seeds the run, its metrics and the edit permission into the query cache. */
const seeded = (kind: Kind, patch: Partial<EvaluationRun> = {}): AgentaDataParameters => ({
    args: (scope: StoryScope) => ({projectId: scope.projectId, runId: scope.id("run")}),
    queries: (scope: StoryScope) => {
        const runId = scope.id("run")
        return [
            [evaluationRunQueryKey(runId), runFor(runId, kind, patch)],
            [runLevelMetricsQueryKey(scope.projectId, runId), metricsFor(runId, kind)],
            [projectPermissionQueryKey(scope.projectId, "edit_evaluation_runs"), true],
        ]
    },
})

export const Loading: Story = {render: () => <RunDetailsSkeleton />}

export const NotFound: Story = {
    parameters: {
        agenta: {
            args: (scope: StoryScope) => ({projectId: scope.projectId, runId: scope.id("run")}),
            queries: (scope: StoryScope) => [[evaluationRunQueryKey(scope.id("run")), null]],
        } satisfies AgentaDataParameters,
    },
}

export const LoadErrorState: Story = {
    name: "LoadError",
    render: () => (
        <LoadError framed title="Could not load this evaluation" onRetry={() => undefined} />
    ),
}

export const AutoRun: Story = {parameters: {agenta: seeded("auto")}}

export const HumanRunning: Story = {parameters: {agenta: seeded("human")}}

export const OnlineActive: Story = {parameters: {agenta: seeded("online")}}

export const OnlinePaused: Story = {
    parameters: {
        agenta: seeded("online", {
            flags: {is_live: true, is_active: false, is_closed: false},
        }),
    },
}

export const Phone: Story = {
    parameters: {agenta: seeded("auto"), viewport: {defaultViewport: "mobile1"}},
}
