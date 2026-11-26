import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, within} from "storybook/test"

import {CreateQueueForm} from "../../../mobile/src/features/annotations/CreateQueueForm"
import type {SelectedEvaluator} from "../../../mobile/src/features/annotations/createQueueTypes"

const EVALUATORS: SelectedEvaluator[] = [
    {
        evaluatorId: "evaluator-tone",
        revisionId: "revision-tone-2",
        evaluatorName: "Tone check",
        version: 2,
        isHuman: true,
    },
    {
        evaluatorId: "evaluator-accuracy",
        revisionId: "revision-accuracy-1",
        evaluatorName: "Accuracy",
        version: 1,
        isHuman: true,
    },
]

type SheetProps = React.ComponentProps<typeof CreateQueueForm>

/** The sheet chrome around the form. The real sheet reads its state from three atoms. */
const SheetFrame = (props: SheetProps & {submitting?: boolean}) => (
    <Sheet open modal={false}>
        <SheetContent side="right">
            <SheetHeader showCloseButton={!props.submitting}>
                <SheetTitle>Create annotation queue</SheetTitle>
                <SheetDescription className="sr-only">
                    Name the queue, choose its type and pick the evaluators that review it.
                </SheetDescription>
            </SheetHeader>
            <CreateQueueForm {...props} />
        </SheetContent>
    </Sheet>
)

const meta = {
    title: "@agenta/mobile/Developer/AnnotationQueues/CreateQueueSheet",
    component: SheetFrame,
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "The create annotation queue sheet from web/mobile, drawn without its data hooks.",
            },
        },
    },
    args: {
        defaultKind: "traces",
        kindLocked: false,
        isSubmitting: false,
        onSubmit: () => undefined,
        onCancel: () => undefined,
    },
} satisfies Meta<typeof SheetFrame>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        await expect(await screen.findByText("Basic details")).toBeVisible()
        await expect(screen.getByRole("button", {name: "Create"})).toBeVisible()
    },
}

export const WithErrors: Story = {
    args: {initial: {submitted: true}},
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        await expect(await screen.findByText("Name is required")).toBeVisible()
        await expect(screen.getByText("At least one evaluator is required")).toBeVisible()
    },
}

export const WithEvaluators: Story = {
    args: {
        initial: {
            name: "Support replies",
            description: "Check the tone of each reply before it goes out.",
            evaluators: EVALUATORS,
        },
    },
}

export const FromSelection: Story = {
    args: {
        defaultKind: "testcases",
        kindLocked: true,
        initial: {name: "Golden set review", evaluators: EVALUATORS.slice(0, 1)},
    },
}

export const Submitting: Story = {
    args: {
        isSubmitting: true,
        initial: {name: "Support replies", evaluators: EVALUATORS},
    },
    render: (args) => <SheetFrame {...args} submitting />,
}
