import {CreateWithAIAddMenu} from "@agenta/entity-ui/drill-in"
import {Clock, Lightning} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

const noop = () => undefined

/**
 * "Add automation" (F05 f2): the shared add menu with two manual rows (`manualItems`) and
 * "Create with AI" last (`aiLast`), with its own hint (`aiHint`). Open it with the "+".
 */
const AddAutomationMenu = () => (
    <div data-testid="add-automation-menu" className="flex w-[440px] justify-end p-4">
        <CreateWithAIAddMenu
            label="Add automation"
            starterPrompt="I want an automation that"
            aiHint="Describe it and let AI set it up"
            aiLast
            manualItems={[
                {
                    key: "app",
                    icon: <Lightning size={16} />,
                    title: "App trigger",
                    hint: "React to an event from a connected app",
                    onSelect: noop,
                },
                {
                    key: "schedule",
                    icon: <Clock size={16} />,
                    title: "Scheduled trigger",
                    hint: "Run on a recurring schedule",
                    onSelect: noop,
                },
            ]}
        />
    </div>
)

const meta = {
    title: "BuilderLayout/automations/Add automation menu",
    component: AddAutomationMenu,
    parameters: {layout: "padded"},
} satisfies Meta<typeof AddAutomationMenu>

export default meta
type Story = StoryObj<typeof meta>

export const Closed: Story = {}
