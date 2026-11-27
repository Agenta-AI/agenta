import {useState} from "react"

import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: the DrillInView barrel does not re-export this control.
import {HarnessSelectControl} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/HarnessSelectControl"

// HarnessSelectControl — the agent harness picker (avatar + canonical name per harness).
const meta = {
    title: "@agenta/entity-ui/DrillIn/HarnessSelectControl",
    component: HarnessSelectControl,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Harness picker, a searchable `Combobox`. Labels come from the schema `oneOf` titles.",
            },
        },
    },
} satisfies Meta<typeof HarnessSelectControl>

export default meta
type Story = StoryObj<typeof meta>

const SCHEMA = {
    type: "string",
    title: "Harness",
    description: "The runtime that executes the agent.",
    enum: ["pi_core", "claude", "codex"],
    oneOf: [
        {const: "pi_core", title: "Pi"},
        {const: "claude", title: "Claude Code"},
        {const: "codex", title: "Codex"},
    ],
} as never

const Live = ({initial, ...rest}: {initial?: string} & Record<string, unknown>) => {
    const [value, setValue] = useState<string | null>(initial ?? null)
    return (
        <div className="max-w-[360px]">
            <HarnessSelectControl
                schema={SCHEMA}
                label="Harness"
                value={value}
                onChange={setValue}
                {...rest}
            />
        </div>
    )
}

/** Selected harness — avatar + canonical schema title in the trigger. */
export const Default: Story = {
    args: {value: "claude", onChange: () => undefined, label: "Harness", schema: SCHEMA},
    render: () => <Live initial="claude" />,
}

/** No value — the placeholder. */
export const Placeholder: Story = {
    args: {value: null, onChange: () => undefined, label: "Harness", schema: SCHEMA},
    render: () => <Live />,
}

/** `visibleValues` hides supported-but-not-selectable harnesses. */
export const RestrictedValues: Story = {
    args: {value: "pi_core", onChange: () => undefined, label: "Harness", schema: SCHEMA},
    render: () => <Live initial="pi_core" visibleValues={["pi_core", "claude"]} />,
}

/** Read-only. */
export const Disabled: Story = {
    args: {value: "claude", onChange: () => undefined, label: "Harness", schema: SCHEMA},
    render: () => <Live initial="claude" disabled />,
}

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[300px]">{children}</div>
    </div>
)

export const Variants: Story = {
    args: {value: "claude", onChange: () => undefined, label: "Harness", schema: SCHEMA},
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row label="selected">
                <HarnessSelectControl
                    schema={SCHEMA}
                    label="Harness"
                    value="claude"
                    onChange={() => undefined}
                />
            </Row>
            <Row label="placeholder">
                <HarnessSelectControl
                    schema={SCHEMA}
                    label="Harness"
                    value={null}
                    onChange={() => undefined}
                />
            </Row>
            <Row label="disabled">
                <HarnessSelectControl
                    schema={SCHEMA}
                    label="Harness"
                    value="claude"
                    onChange={() => undefined}
                    disabled
                />
            </Row>
        </div>
    ),
}
