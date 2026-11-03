import type {Meta, StoryObj} from "@storybook/nextjs"

import {QueueConfigurationTab} from "../../../mobile/src/features/annotations/QueueConfigurationTab"
import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {sessionStateAtom, traceQueueState} from "../../fixtures/annotationSession"

const QUEUE_ID = "queue-config"
const EVALUATOR_ID = "evaluator-tone-rev"

const queue = {
    id: QUEUE_ID,
    name: "Support replies",
    description: "Rate each reply for **tone** and **accuracy**.",
    data: {kind: "traces", repeats: 2, assignments: [["user-alex", "user-sam"], ["user-robin"]]},
}

const evaluator = {
    id: EVALUATOR_ID,
    slug: "tone",
    name: "Tone review",
    version: 2,
    flags: {is_feedback: true},
    data: {
        uri: "agenta:custom:feedback:v0",
        schemas: {
            outputs: {
                type: "object",
                properties: {friendly: {type: "boolean"}, score: {type: "integer"}},
            },
        },
    },
}

const Frame = ({canDelete}: {canDelete: boolean}) => (
    <div className="flex h-[900px] max-h-dvh w-full flex-col">
        <QueueConfigurationTab queueId={QUEUE_ID} canDelete={canDelete} listHref="#queues" />
    </div>
)

const withData = (evaluatorIds: string[], seedEvaluator = true) => ({
    agenta: {
        atoms: [[sessionStateAtom, traceQueueState({evaluatorIds})]],
        queries: (scope: StoryScope) => [
            [["simpleQueue", QUEUE_ID], queue],
            ...(seedEvaluator
                ? [[["workflows", "revision", EVALUATOR_ID, scope.projectId], evaluator]]
                : []),
        ],
    },
})

const meta = {
    title: "@agenta/mobile/Developer/AnnotationQueues/AnnotationConfiguration",
    component: Frame,
    args: {canDelete: true},
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "The Configuration tab from web/mobile, read only: the API has no route that edits a queue.",
            },
        },
        ...withData([EVALUATOR_ID]),
    },
} satisfies Meta<typeof Frame>

export default meta
type Story = StoryObj<typeof meta>

export const Filled: Story = {}

export const NoEvaluators: Story = {parameters: withData([])}

export const EvaluatorLoading: Story = {parameters: withData([EVALUATOR_ID], false)}

export const ReadOnly: Story = {args: {canDelete: false}}
