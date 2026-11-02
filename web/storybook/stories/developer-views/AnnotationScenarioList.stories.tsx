import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, userEvent, within} from "storybook/test"

import {ScenarioListTab} from "../../../mobile/src/features/annotations/ScenarioListTab"
import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {
    installStoryHandlers,
    sessionStateAtom,
    STORY_TRACES,
    testcaseQueueState,
    traceQueueState,
    traceQueries,
    type FakeSessionState,
} from "../../fixtures/annotationSession"

installStoryHandlers()

const Frame = () => (
    <div className="flex h-[720px] max-h-dvh w-full flex-col bg-background">
        <ScenarioListTab queueId="queue-1" onViewChange={() => undefined} />
    </div>
)

const withSession = (state: FakeSessionState) => ({
    agenta: {
        atoms: [[sessionStateAtom, state]],
        queries: (scope: StoryScope) => traceQueries(scope.projectId, STORY_TRACES),
    },
})

const meta = {
    title: "@agenta/mobile/Developer/AnnotationQueues/AnnotationScenarioList",
    component: Frame,
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "The All Annotations tab from web/mobile: every item with its status and metrics, search, a status filter, selection and the annotate sheet.",
            },
        },
        ...withSession(traceQueueState()),
    },
} satisfies Meta<typeof Frame>

export default meta
type Story = StoryObj<typeof meta>

export const TraceRows: Story = {
    play: async ({canvasElement}) => {
        const screen = within(canvasElement)
        await expect(await screen.findByText("Failed")).toBeVisible()
        await expect(screen.getByText("answer_refund_question")).toBeVisible()
    },
}

export const TestcaseRows: Story = {parameters: withSession(testcaseQueueState())}

export const Filtered: Story = {
    play: async ({canvasElement}) => {
        const screen = within(canvasElement)
        await userEvent.type(await screen.findByPlaceholderText("Search"), "shipping")
        await expect(await screen.findByText("answer_shipping_question")).toBeVisible()
    },
}

export const WithSelection: Story = {
    parameters: withSession(traceQueueState({selectedScenarioIds: ["s-1", "s-3"]})),
}

export const SheetOpen: Story = {
    play: async ({canvasElement}) => {
        const screen = within(canvasElement)
        await userEvent.click(await screen.findByText("answer_shipping_question"))
        const body = within(canvasElement.ownerDocument.body)
        await expect(await body.findByText("Annotate Scenario")).toBeVisible()
    },
}
