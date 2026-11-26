import {projectPermissionQueryKey} from "@agenta/entities/access"
import {
    evaluationRunQueryKey,
    type EvaluationRun,
    type RunHeader,
} from "@agenta/entities/evaluationRun"
import type {RunColumnGroup} from "@agenta/entities/evaluationRun/etl"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {RunAnnotateSheet} from "../../../mobile/src/features/evaluation-run/focus/RunAnnotateSheet"
import {RunAnnotateTab} from "../../../mobile/src/features/evaluation-run/focus/RunAnnotateTab"
import type {
    ScenarioRow,
    ScenarioRowData,
} from "../../../mobile/src/features/evaluation-run/scenarios/scenarioColumns"
import {runScenariosQueryKey} from "../../../mobile/src/features/evaluation-run/scenarios/useRunScenarios"
import type {AgentaDataParameters, StoryScope} from "../../.storybook/decorators/withAgentaData"
import {
    initialSessionState,
    installStoryHandlers,
    sessionStateAtom,
    type FakeSessionState,
} from "../../fixtures/annotationSession"

installStoryHandlers()

const OUTPATH = "attributes.ag.data.outputs"

const HEADER: RunHeader = {
    name: "Capitals review",
    description: null,
    status: "running",
    kind: "human",
    flags: {isLive: false, isClosed: false, isActive: true},
    createdAt: null,
    updatedAt: null,
    createdById: null,
}

const GROUPS: RunColumnGroup[] = [
    {
        group: {
            key: "testset:capitals",
            kind: "testset",
            slug: "capitals",
            label: "capitals",
            refs: null,
        },
        columns: [],
    },
    {
        group: {
            key: "application:geography-bot",
            kind: "application",
            slug: "geography-bot",
            label: "geography-bot",
            refs: null,
        },
        columns: [],
    },
]

/** A human run: a test set, an app, and one human evaluator. */
function runFor(id: string): EvaluationRun {
    return {
        id,
        name: "Capitals review",
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
                    key: "application-geo.quality",
                    type: "annotation",
                    origin: "human",
                    references: {evaluator: {id: `${id}-ev`, slug: "quality"}},
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
            ],
        },
    }
}

function row(position: number, hasOutput = true): ScenarioRowData {
    return {
        scenario: {id: `sc-${position}`, run_id: "run", status: hasOutput ? "success" : "pending"},
        valuesFailed: false,
        invocation: hasOutput
            ? {traceId: `trace-${position}`, status: "success"}
            : {traceId: null, status: "pending"},
        cells: {
            "testset:capitals": [
                {
                    name: "question",
                    kind: "testset",
                    path: "data.question",
                    value: ["What is the capital of Japan?", "What is the capital of Peru?"][
                        position % 2
                    ],
                },
            ],
            "application:geography-bot": [
                {
                    name: "answer",
                    kind: "application",
                    path: OUTPATH,
                    value: hasOutput ? ["Tokyo", "Lima"][position % 2] : undefined,
                },
            ],
        },
    }
}

const QUALITY_FIELDS = {
    correct: {value: null, type: "boolean"},
    score: {value: null, type: "integer", minimum: 1, maximum: 5},
    comment: {value: null, type: "string"},
}

const session = (patch: Partial<FakeSessionState> = {}): FakeSessionState => ({
    ...initialSessionState(),
    activeQueueId: null,
    evaluatorStepRefs: [{slug: "quality"}],
    evaluators: [{slug: "quality", name: "Quality"}],
    metrics: {"sc-1": {quality: QUALITY_FIELDS}, "sc-2": {quality: QUALITY_FIELDS}},
    ...patch,
})

/** The run's scenarios, the edit right, and the annotation form's state. */
const seeded = (
    state: FakeSessionState,
    {rows = [row(1), row(2), row(3)], canAnnotate = true} = {},
): AgentaDataParameters => ({
    args: (scope: StoryScope) => ({runId: scope.id("run")}),
    atoms: [[sessionStateAtom, state]],
    queries: (scope: StoryScope) => {
        const runId = scope.id("run")
        return [
            [evaluationRunQueryKey(runId), runFor(runId)],
            [projectPermissionQueryKey(scope.projectId, "edit_annotations"), canAnnotate],
            [
                runScenariosQueryKey(scope.projectId, runId),
                {pages: [{cursor: null, nextCursor: null, rows}], pageParams: [null]},
            ],
        ]
    },
})

const TabStory = ({runId}: {runId: string}) => (
    <div className="min-h-dvh bg-background p-4 text-foreground">
        <RunAnnotateTab runId={runId} header={HEADER} />
    </div>
)

const meta = {
    title: "@agenta/mobile/Developer/Evaluations/RunAnnotate",
    component: TabStory,
    parameters: {layout: "fullscreen"},
    args: {runId: ""},
} satisfies Meta<typeof TabStory>

export default meta
type Story = StoryObj<typeof meta>

export const ReadyToAnnotate: Story = {parameters: {agenta: seeded(session())}}

export const Annotated: Story = {
    parameters: {
        agenta: seeded(
            session({
                metrics: {
                    "sc-1": {
                        quality: {
                            correct: {value: true, type: "boolean"},
                            score: {value: 4, type: "integer", minimum: 1, maximum: 5},
                            comment: {value: "Right city, short answer.", type: "string"},
                        },
                    },
                },
                hasFilledMetrics: {"sc-1": true},
                hasPendingChanges: {"sc-1": true},
            }),
        ),
    },
}

export const NoOutput: Story = {
    parameters: {agenta: seeded(session(), {rows: [row(1, false), row(2)]})},
}

export const NoEvaluators: Story = {
    parameters: {agenta: seeded(session({evaluatorStepRefs: [], evaluators: []}))},
}

export const SubmitError: Story = {
    parameters: {
        agenta: seeded(
            session({
                submitError: {"sc-1": "Request failed"},
                hasFilledMetrics: {"sc-1": true},
                hasPendingChanges: {"sc-1": true},
            }),
        ),
    },
}

export const ReadOnly: Story = {
    parameters: {agenta: seeded(session(), {canAnnotate: false})},
}

export const NoScenarios: Story = {parameters: {agenta: seeded(session(), {rows: []})}}

const SheetStory = ({runId}: {runId: string}) => (
    <div className="text-foreground">
        <RunAnnotateSheet
            runId={runId}
            row={{...row(2), index: 2} as ScenarioRow}
            groups={GROUPS}
            labels={{
                "testset:capitals": "Test set capitals",
                "application:geography-bot": "Geography bot",
            }}
            onRetry={() => undefined}
            onClose={() => undefined}
        />
    </div>
)

export const Sheet: StoryObj<typeof SheetStory> = {
    render: (args) => <SheetStory {...args} />,
    parameters: {agenta: seeded(session())},
}
