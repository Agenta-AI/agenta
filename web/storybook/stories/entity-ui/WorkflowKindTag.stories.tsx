import {WorkflowKindTag} from "@agenta/entity-ui/workflow"
import type {Meta, StoryObj} from "@storybook/nextjs"

// WorkflowKindTag — the App/Evaluator "kind" pill, a `Badge` variant `purple`/`blue`.
const meta = {
    title: "@agenta/entity-ui/Workflow/WorkflowKindTag",
    component: WorkflowKindTag,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Kind pill for a workflow row — `App` (blue) or `Evaluator` (purple), rendered as a `@agenta/ui` `Badge` preset variant.",
            },
        },
    },
} satisfies Meta<typeof WorkflowKindTag>

export default meta
type Story = StoryObj<typeof meta>

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">{children}</div>
    </div>
)

export const Variants: Story = {
    args: {isEvaluator: false},
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="app">
                <WorkflowKindTag isEvaluator={false} />
            </Row>
            <Row label="evaluator">
                <WorkflowKindTag isEvaluator />
            </Row>
        </div>
    ),
}
