import {useState} from "react"

import {RailField} from "@agenta/entity-ui/drawers/shared"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Select as AntSelect} from "antd"

// Imported from source: agentTemplate internals are not re-exported from the DrillInView barrel.
import {PermissionPolicySelect} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/PermissionPolicySelect"

// PermissionPolicySelect — `runner.permissions.default` ("what the agent may do on its own before
// it must ask"), extracted from `useModelHarness` so it can be storied with plain props.
// Migration: antd `Select optionLabelProp="title"` with two-line ReactNode labels → `@agenta/ui`
// `Select`, where the trigger label is passed explicitly to `SelectValue` (that IS
// `optionLabelProp`) and the two-line row lives inside `SelectItem`.
//
// The antd half replays the pre-migration markup from
// `git show feat/storybook-data-seam:web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/useModelHarness.tsx`
// (`permissionsBody`).
const meta = {
    title: "@agenta/entity-ui/DrillIn/PermissionPolicySelect",
    component: PermissionPolicySelect,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The runner permission policy picker. Radix `SelectValue` renders the selected item's text by default; passing it explicit children reproduces antd's `optionLabelProp=\"title\"` (bare label in the trigger, label + help line in the dropdown).",
            },
        },
    },
} satisfies Meta<typeof PermissionPolicySelect>

export default meta
type Story = StoryObj<typeof meta>

const OPTIONS = [
    {value: "allow_reads", title: "Allow reads", help: "Reads run, writes ask; default"},
    {value: "allow", title: "Allow all", help: "Every tool runs without asking"},
    {value: "ask", title: "Ask", help: "A human approves every tool call"},
    {value: "deny", title: "Deny all", help: "Every tool call is refused"},
]

/** Pre-migration antd option shape: `title` for the trigger, a two-line node for the dropdown. */
const ANTD_OPTIONS = OPTIONS.map((option) => ({
    value: option.value,
    title: option.title,
    label: (
        <div className="flex flex-col py-0.5">
            <span>{option.title}</span>
            <span className="text-[11px] leading-snug text-[var(--ag-colorTextTertiary)]">
                {option.help}
            </span>
        </div>
    ),
}))

/** Pre-migration antd markup. */
const AntdPermissionPolicySelect = ({
    value = "allow_reads",
    disabled,
    open,
    getPopupContainer,
}: {
    value?: string
    disabled?: boolean
    open?: boolean
    getPopupContainer?: (node: HTMLElement) => HTMLElement
}) => (
    <AntSelect
        value={value}
        options={ANTD_OPTIONS}
        optionLabelProp="title"
        disabled={disabled}
        open={open}
        getPopupContainer={getPopupContainer}
        className="w-full"
    />
)

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

/** Default policy — "Allow reads". */
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
        className="grid grid-cols-[10rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="w-[320px]" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[320px]" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {value: "allow_reads", onChange: () => undefined, options: OPTIONS},
    render: () => (
        <div className="flex max-w-[1050px] flex-col">
            <Row
                label="closed trigger"
                a={<AntdPermissionPolicySelect />}
                s={
                    <PermissionPolicySelect
                        value="allow_reads"
                        onChange={() => undefined}
                        options={OPTIONS}
                    />
                }
            />
            <Row
                label="closed (disabled)"
                a={<AntdPermissionPolicySelect disabled />}
                s={
                    <PermissionPolicySelect
                        value="allow_reads"
                        onChange={() => undefined}
                        options={OPTIONS}
                        disabled
                    />
                }
            />
        </div>
    ),
}

/** Forced-OPEN dropdown rendered INLINE — the two-line option rows are what `optionLabelProp` hides. */
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
        <div
            className="flex gap-16 p-4"
            data-open-compare
            data-vrt-expected="selected row shows the @agenta/ui Select's Check ItemIndicator, a documented deliberate deviation from antd v6 (which dropped v5's check) — see migrations/Select.md"
        >
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">antd</div>
                <Panel
                    render={(c) => <AntdPermissionPolicySelect open getPopupContainer={() => c} />}
                />
            </div>
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">agenta</div>
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
        </div>
    ),
}
