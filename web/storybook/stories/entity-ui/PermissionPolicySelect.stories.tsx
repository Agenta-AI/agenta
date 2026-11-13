import {useState} from "react"

import {RailField} from "@agenta/entity-ui/drawers/shared"
import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: agentTemplate internals are not re-exported from the DrillInView barrel.
import {PermissionPolicySelect} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/PermissionPolicySelect"

// PermissionPolicySelect — `runner.permissions.default` ("what the agent may do on its own before
// it must ask"), extracted from `useModelHarness` so it can be storied with plain props.
const meta = {
    title: "@agenta/entity-ui/DrillIn/PermissionPolicySelect",
    component: PermissionPolicySelect,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The runner permission policy picker. The trigger shows the bare label of the selected policy; each dropdown row adds a help line.",
            },
        },
    },
} satisfies Meta<typeof PermissionPolicySelect>

export default meta
type Story = StoryObj<typeof meta>

const OPTIONS = [
    {value: "allow_reads", title: "Allow reads", help: "Reads run, writes ask"},
    {value: "allow", title: "Allow all", help: "Every tool runs without asking"},
    {value: "ask", title: "Ask", help: "A human approves every tool call"},
    {value: "deny", title: "Deny all", help: "Every tool call is refused"},
]

const Live = ({disabled}: {disabled?: boolean}) => {
    const [value, setValue] = useState("allow_reads")
    return (
        <div className="max-w-[420px]">
            <RailField label="Policy" align="center">
                <PermissionPolicySelect
                    value={value}
                    onChange={setValue}
                    options={OPTIONS}
                    disabled={disabled}
                />
            </RailField>
        </div>
    )
}

/** The selector on "Allow reads", the policy an agent runs on when its config names none. */
export const Default: Story = {
    args: {value: "allow_reads", onChange: () => undefined, options: OPTIONS},
    render: () => <Live />,
}

/** Read-only surface — the trigger takes the disabled skin. */
export const Disabled: Story = {
    args: {value: "allow_reads", onChange: () => undefined, options: OPTIONS, disabled: true},
    render: () => <Live disabled />,
}

/** A schema that publishes only a subset of the policies. */
export const NarrowedBySchema: Story = {
    args: {value: "ask", onChange: () => undefined, options: OPTIONS.slice(2)},
    render: () => (
        <div className="max-w-[420px]">
            <PermissionPolicySelect
                value="ask"
                onChange={() => undefined}
                options={OPTIONS.slice(2)}
            />
        </div>
    ),
}

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

export const Variants: Story = {
    args: {value: "allow_reads", onChange: () => undefined, options: OPTIONS},
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="closed trigger">
                <PermissionPolicySelect
                    value="allow_reads"
                    onChange={() => undefined}
                    options={OPTIONS}
                />
            </Row>
            <Row label="closed (disabled)">
                <PermissionPolicySelect
                    value="allow_reads"
                    onChange={() => undefined}
                    options={OPTIONS}
                    disabled
                />
            </Row>
        </div>
    ),
}

/** Forced-OPEN dropdown rendered INLINE — shows the two-line option rows. */
function Panel({render}: {render: (container: HTMLElement) => React.ReactNode}) {
    const [el, setEl] = useState<HTMLElement | null>(null)
    return (
        <div ref={setEl} className="relative min-h-[280px] w-[320px]">
            {el && render(el)}
        </div>
    )
}

export const OpenState: Story = {
    args: {value: "allow_reads", onChange: () => undefined, options: OPTIONS},
    render: () => (
        <div className="flex gap-16 p-4">
            <Panel
                render={(c) => (
                    <PermissionPolicySelect
                        value="allow_reads"
                        onChange={() => undefined}
                        options={OPTIONS}
                        open
                        container={c}
                    />
                )}
            />
        </div>
    ),
}
