import {WorkflowKindTag} from "@agenta/entity-ui/workflow"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Tag as AntTag} from "antd"

// WorkflowKindTag — the App/Evaluator "kind" pill. The antd cell replays the
// pre-migration body verbatim (`<Tag color="purple"|"blue">`, antd v6 default =
// filled preset: bg hue-1, text hue-7, no border); the agenta cell renders the
// migrated component (`Badge` variant `purple`/`blue`).
const meta = {
    title: "@agenta/entity-ui/Workflow/WorkflowKindTag",
    component: WorkflowKindTag,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Kind pill for a workflow row — `App` (blue) or `Evaluator` (purple). antd `Tag` preset → `@agenta/ui` `Badge` preset variant.",
            },
        },
    },
} satisfies Meta<typeof WorkflowKindTag>

export default meta
type Story = StoryObj<typeof meta>

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: React.ReactNode
    s: React.ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[14rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            {a}
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            {s}
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {isEvaluator: false},
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row
                label="app"
                a={<AntTag color="blue">App</AntTag>}
                s={<WorkflowKindTag isEvaluator={false} />}
            />
            <Row
                label="evaluator"
                // purple deviates in DARK only (dark step 7 → 8) — palette.ts presetTag.
                expected="WCAG AA: purple text sits one step down antd's dark ramp so preset tags reach 4.5:1 — see presetTag in palette.ts"
                a={<AntTag color="purple">Evaluator</AntTag>}
                s={<WorkflowKindTag isEvaluator />}
            />
        </div>
    ),
}
