import {ElicitationDock} from "@agenta/chat/components"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {makeChoiceFormDockState} from "../../../fixtures/builderLayout/choice-form"

/**
 * The "Decisions for you" form of the builder (task 28.2): today's elicitation card showing one
 * recorded `request_input` call. Two single choices (recommended first and preselected) and one
 * multiline field, asked one question at a time, then a review step.
 */
const ChoiceFormDemo = () => (
    <div data-testid="choice-form" className="w-[420px] bg-background p-4">
        <ElicitationDock elicits={makeChoiceFormDockState()} onOutput={() => true} />
    </div>
)

const meta = {
    title: "BuilderLayout/choice-form/Choice form",
    component: ChoiceFormDemo,
    parameters: {layout: "centered"},
} satisfies Meta<typeof ChoiceFormDemo>

export default meta
type Story = StoryObj<typeof meta>

/** The first question: the recommended option is selected before the person touches anything. */
export const FirstChoice: Story = {}
