import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, userEvent, within} from "storybook/test"

import {FocusView} from "../../../mobile/src/features/annotations/FocusView"
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
        <FocusView queueId="queue-1" observabilityHref="#observability" />
    </div>
)

const withSession = (state: FakeSessionState) => ({
    agenta: {
        atoms: [[sessionStateAtom, state]],
        queries: (scope: StoryScope) => traceQueries(scope.projectId, STORY_TRACES),
    },
})

const meta = {
    title: "@agenta/mobile/Developer/AnnotationQueues/AnnotationFocusView",
    component: Frame,
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "The Annotate tab from web/mobile: one item, its form and the footer. The session controllers are a stand-in here; the trace overview reads seeded traces.",
            },
        },
        ...withSession(traceQueueState()),
    },
} satisfies Meta<typeof Frame>

export default meta
type Story = StoryObj<typeof meta>

export const TraceQueue: Story = {
    play: async ({canvasElement}) => {
        const screen = within(canvasElement)
        await expect(await screen.findByText("Annotations")).toBeVisible()
        // Fill a boolean, then save with the keyboard.
        await userEvent.click(screen.getAllByRole("radio", {name: "True"})[0])
        await expect(screen.getByRole("button", {name: /Mark completed/})).toBeEnabled()
        await userEvent.keyboard("{Control>}{Enter}{/Control}")
        await expect(await screen.findByText("Completed")).toBeVisible()
    },
}

export const TestcaseQueue: Story = {parameters: withSession(testcaseQueueState())}

export const AllCaughtUp: Story = {
    parameters: withSession(
        traceQueueState({progress: {total: 3, completed: 3, remaining: 0, currentIndex: 0}}),
    ),
}

export const HiddenBySwitches: Story = {
    parameters: withSession(
        traceQueueState({
            focusScenarioIds: [],
            currentScenarioId: null,
            hideCompletedInFocus: true,
        }),
    ),
}

export const ScenariosError: Story = {
    parameters: withSession(
        traceQueueState({scenariosQuery: {isPending: false, isError: true, data: null}}),
    ),
}

export const Phone: Story = {
    globals: {viewport: {value: "mobile1"}},
    parameters: {viewport: {defaultViewport: "mobile1"}},
}
