import type {Meta, StoryObj} from "@storybook/nextjs"

// Field/Label aren't on the @agenta/ui barrel yet → relative source imports.
import {Field} from "../../packages/agenta-ui/src/components/ui/field"
import {Input} from "../../packages/agenta-ui/src/components/ui/input"

const meta = {
    title: "@agenta/ui/Primitives/Forms/Field",
    component: Field,
    parameters: {
        docs: {
            description: {
                component:
                    "The `@agenta/ui` Field — a label + control wrapper with `required`, `description`, `error`, `tooltip` and `direction` props.\n\n**Used in:** 11 places — nine agent config drill-in controls (`@agenta/entity-ui/DrillInView/SchemaControls`: text input, enum select, code editor, grouped choice, harness select, hook config, feedback config, tags editor, skill form) plus `CommitMessageInput` and `LabelInput`.",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

const CONTROL_BOX = "w-[220px] shrink-0"

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[16rem_auto] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className={CONTROL_BOX}>{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[560px] flex-col">
            <Row label="label only">
                <Field label="Temperature">{null}</Field>
            </Row>
            <Row label="tooltip">
                <Field label="Temperature" tooltip="Controls randomness">
                    <Input placeholder="0.7" />
                </Field>
            </Row>
            <Row label="required (red asterisk)">
                <Field label="API key" required>
                    <Input placeholder="sk-..." />
                </Field>
            </Row>
            <Row label="horizontal">
                <Field label="Stream" direction="horizontal">
                    <Input placeholder="on" />
                </Field>
            </Row>
            <Row label="description">
                <Field label="Model" description="Pick a chat-capable model">
                    <Input placeholder="gpt-4o" />
                </Field>
            </Row>
            <Row label="error">
                <Field label="API key" error="This field is required">
                    <Input aria-invalid placeholder="sk-..." />
                </Field>
            </Row>
        </div>
    ),
}
