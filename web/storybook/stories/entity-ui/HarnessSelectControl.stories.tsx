import {useState} from "react"

import {Field} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Select as AntSelect, Typography} from "antd"

// Imported from source: the DrillInView barrel does not re-export this control.
import {HarnessSelectControl} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/HarnessSelectControl"

// HarnessSelectControl — the agent harness picker (avatar + canonical name per harness).
// Migration: antd `<Select showSearch optionLabelProp labelRender optionRender />` → `Combobox`
// (the searchable-select primitive; Radix Select cannot search).
//
// The antd half replays the pre-migration markup from
// `git show feat/storybook-data-seam:web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/HarnessSelectControl.tsx`
// inside the same (already-migrated) `Field` chrome.
const meta = {
    title: "@agenta/entity-ui/DrillIn/HarnessSelectControl",
    component: HarnessSelectControl,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Harness picker. Labels come from the schema `oneOf` titles; the avatar (brand colour + monogram) is supplied FE-side per harness id. antd `Select showSearch` → `Combobox`. DECLARED DIVERGENCE: antd sized the avatar 18px in the trigger (`labelRender`) and 22px in the dropdown row (`optionRender`); the Combobox has ONE `label` slot, so both render at the trigger's 18px. The closed control — what the parity grid gates — is unchanged.",
            },
        },
    },
} satisfies Meta<typeof HarnessSelectControl>

export default meta
type Story = StoryObj<typeof meta>

const HARNESS_META: Record<string, {label: string; short: string; color: string}> = {
    pi_core: {label: "Pi", short: "Pi", color: "#6b5bd6"},
    claude: {label: "Claude Code", short: "CC", color: "#d97757"},
    codex: {label: "Codex", short: "Cx", color: "#10a37f"},
}

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

const HarnessAvatar = ({id, size = 22}: {id: string; size?: number}) => {
    const meta = HARNESS_META[id]
    return (
        <span
            className="flex shrink-0 items-center justify-center rounded font-semibold text-white"
            style={{
                width: size,
                height: size,
                background: meta.color,
                fontSize: size <= 18 ? 9 : 10,
                lineHeight: 1,
            }}
        >
            {meta.short}
        </span>
    )
}

/** Pre-migration antd markup (the Field chrome is shared and already migrated). */
const AntdHarnessSelect = ({value, disabled}: {value?: string; disabled?: boolean}) => (
    <Field label="Harness" tooltip="The runtime that executes the agent.">
        <AntSelect
            value={value}
            disabled={disabled}
            placeholder="Select harness"
            className="w-full"
            options={Object.keys(HARNESS_META).map((id) => ({
                value: id,
                label: HARNESS_META[id].label,
            }))}
            optionLabelProp="label"
            showSearch
            labelRender={(cur) => (
                <span className="flex items-center gap-2">
                    <HarnessAvatar id={String(cur.value)} size={18} />
                    <span>{HARNESS_META[String(cur.value)].label}</span>
                </span>
            )}
            optionRender={(opt) => (
                <span className="flex items-center gap-2 py-0.5">
                    <HarnessAvatar id={String(opt.value)} size={22} />
                    <Typography.Text>{HARNESS_META[String(opt.value)].label}</Typography.Text>
                </span>
            )}
        />
    </Field>
)

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
        className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="w-[300px]" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[300px]" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {value: "claude", onChange: () => undefined, label: "Harness", schema: SCHEMA},
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row
                label="selected"
                a={<AntdHarnessSelect value="claude" />}
                s={
                    <HarnessSelectControl
                        schema={SCHEMA}
                        label="Harness"
                        value="claude"
                        onChange={() => undefined}
                    />
                }
            />
            <Row
                label="placeholder"
                a={<AntdHarnessSelect />}
                s={
                    <HarnessSelectControl
                        schema={SCHEMA}
                        label="Harness"
                        value={null}
                        onChange={() => undefined}
                    />
                }
            />
            <Row
                label="disabled"
                a={<AntdHarnessSelect value="claude" disabled />}
                s={
                    <HarnessSelectControl
                        schema={SCHEMA}
                        label="Harness"
                        value="claude"
                        onChange={() => undefined}
                        disabled
                    />
                }
            />
        </div>
    ),
}
