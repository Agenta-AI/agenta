import {RunnableOutputValue} from "@agenta/entity-ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Tag as AntTag} from "antd"

// RunnableOutputValue — schema-aware output renderer. Only the BOOLEAN branch was antd
// (`<Tag color="green"|"default">`); the antd cell replays it verbatim. The other value
// kinds render the same plain spans on both sides and are included for coverage.
const meta = {
    title: "@agenta/entity-ui/Shared/RunnableOutputValue",
    component: RunnableOutputValue,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Renders one runnable/evaluator output value by schema type. Boolean antd `Tag` → `@agenta/ui` `Badge` (`green`/`default`); numbers/strings/objects are plain text.",
            },
        },
    },
} satisfies Meta<typeof RunnableOutputValue>

export default meta
type Story = StoryObj<typeof meta>

// Badge green text sits one step down antd's ramp for WCAG AA — see presetTag in palette.ts.
const AA_NOTE =
    "WCAG AA: green text sits one step down antd's own ramp so preset tags reach 4.5:1 — see presetTag in palette.ts"

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
            <div className="inline-flex" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div className="inline-flex" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

const rangeSchema = {type: "number", minimum: 0, maximum: 10}

export const AntdVsAgenta: Story = {
    args: {value: true},
    render: () => (
        <div className="flex max-w-[820px] flex-col">
            <Row
                label="boolean · true"
                expected={AA_NOTE}
                a={
                    <AntTag color="green" className="!m-0 text-xs">
                        true
                    </AntTag>
                }
                s={<RunnableOutputValue value={true} />}
            />
            <Row
                label="boolean · false"
                a={
                    <AntTag color="default" className="!m-0 text-xs">
                        false
                    </AntTag>
                }
                s={<RunnableOutputValue value={false} />}
            />
            <Row
                label="number"
                a={<span>0.857143</span>}
                s={<RunnableOutputValue value={0.857142857} />}
            />
            <Row
                label="number with schema range"
                a={
                    <span>
                        7<span className="text-[var(--ant-color-text-quaternary)] ml-1">/ 10</span>
                    </span>
                }
                s={<RunnableOutputValue value={7} schema={rangeSchema} />}
            />
            <Row
                label="string"
                a={<span>exact match</span>}
                s={<RunnableOutputValue value="exact match" />}
            />
            <Row
                label="object → JSON"
                a={<span>{JSON.stringify({score: 1})}</span>}
                s={<RunnableOutputValue value={{score: 1}} />}
            />
            <Row
                label="null → em dash"
                a={<span className="text-[var(--ant-color-text-quaternary)]">—</span>}
                s={<RunnableOutputValue value={null} />}
            />
        </div>
    ),
}
