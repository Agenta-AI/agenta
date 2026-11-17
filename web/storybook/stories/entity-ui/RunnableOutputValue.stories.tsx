import {RunnableOutputValue} from "@agenta/entity-ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

// RunnableOutputValue — schema-aware output renderer. Booleans render as a `Badge`; the other
// value kinds render plain spans.
const meta = {
    title: "@agenta/entity-ui/Shared/RunnableOutputValue",
    component: RunnableOutputValue,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Renders one runnable/evaluator output value by schema type. Booleans render as a green or default `Badge`; numbers, strings and objects are plain text.",
            },
        },
    },
} satisfies Meta<typeof RunnableOutputValue>

export default meta
type Story = StoryObj<typeof meta>

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

const rangeSchema = {type: "number", minimum: 0, maximum: 10}

export const Variants: Story = {
    args: {value: true},
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="boolean · true">
                <RunnableOutputValue value={true} />
            </Row>
            <Row label="boolean · false">
                <RunnableOutputValue value={false} />
            </Row>
            <Row label="number">
                <RunnableOutputValue value={0.857142857} />
            </Row>
            <Row label="number with schema range">
                <RunnableOutputValue value={7} schema={rangeSchema} />
            </Row>
            <Row label="string">
                <RunnableOutputValue value="exact match" />
            </Row>
            <Row label="object → JSON">
                <RunnableOutputValue value={{score: 1}} />
            </Row>
            <Row label="null → em dash">
                <RunnableOutputValue value={null} />
            </Row>
        </div>
    ),
}
