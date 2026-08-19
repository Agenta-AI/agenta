import {useState} from "react"

import {RailField, railInfoLabel} from "@agenta/entity-ui/drawers/shared"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Input as AntInput, Select as AntSelect} from "antd"

// Imported from source: the DrillInView barrel does not re-export this control (its only
// consumer is AgentTemplateControl). Same relative-import convention the @agenta/ui primitive
// stories use for unbarrelled components.
import {ClaudePermissionsControl} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/ClaudePermissionsControl"

// ClaudePermissionsControl — the Claude harness permission knobs (mode + allow/ask/deny rule
// lists) as `RailField` rows. Migration: antd `Select allowClear` → `Combobox` (Radix Select has
// no clear affordance), antd `Input.TextArea rows={2}` → `Textarea`.
//
// The antd half of the parity grid replays the pre-migration markup verbatim from
// `git show feat/storybook-data-seam:web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/ClaudePermissionsControl.tsx`
// inside the SAME (already-migrated, parity-proven) `RailField` chrome, so the diff isolates the
// controls that actually changed.
const meta = {
    title: "@agenta/entity-ui/DrillIn/ClaudePermissionsControl",
    component: ClaudePermissionsControl,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Claude `harness.permissions`: permission mode + per-tool allow/ask/deny rule lists (one rule per line). antd `Select allowClear` → `Combobox`; antd `Input.TextArea` → `Textarea`.",
            },
        },
    },
} satisfies Meta<typeof ClaudePermissionsControl>

export default meta
type Story = StoryObj<typeof meta>

const MODE_OPTIONS = [
    {value: "default", label: "Default (prompt on each gated tool)"},
    {value: "acceptEdits", label: "Accept edits (auto-accept file edits)"},
    {value: "plan", label: "Plan (read-only planning)"},
    {value: "bypassPermissions", label: "Bypass (skip every gate)"},
]

const MODE_HINT = "Claude Code's default permission mode for this headless run."
const ALLOW_HINT = 'Per-tool allow rules, one per line (e.g. "Read", "Bash(npm run:*)").'
const ASK_HINT = "Per-tool rules that prompt before use, one per line."
const DENY_HINT = "Per-tool rules that are always blocked, one per line."

// A type alias (not an interface): TS gives object type ALIASES an implicit index signature, so
// this stays assignable to the control's `Record<string, unknown>` value prop.
// A type alias, not an interface: only aliases get the implicit index signature that
// makes this assignable to the control's `Record<string, unknown>` value prop.
interface PermValue {
    default_mode?: string
    allow: string[]
    ask: string[]
    deny: string[]
}

const VALUE: PermValue = {
    default_mode: "acceptEdits",
    allow: ["Read", "Bash(npm run:*)"],
    ask: ["Bash(rm:*)"],
    deny: ["Write"],
}

const EMPTY: PermValue = {allow: [], ask: [], deny: []}

/** Both halves sit in the same wrapper — the component itself is a fragment of RailField rows. */
const Frame = ({children}: {children: React.ReactNode}) => (
    <div className="flex flex-col gap-3">{children}</div>
)

/** Pre-migration antd markup (the RailField chrome is shared and already migrated). */
const AntdClaudePermissions = ({
    value = VALUE,
    disabled,
}: {
    value?: PermValue
    disabled?: boolean
}) => (
    <Frame>
        <RailField label={railInfoLabel("Permission mode", MODE_HINT)} align="center">
            <AntSelect
                value={value.default_mode || undefined}
                options={MODE_OPTIONS}
                placeholder="Claude default"
                allowClear
                disabled={disabled}
                className="w-full"
            />
        </RailField>
        <RailField label={railInfoLabel("Allow rules", ALLOW_HINT)}>
            <AntInput.TextArea
                value={value.allow.join("\n")}
                placeholder={"Read\nBash(npm run:*)"}
                rows={2}
                disabled={disabled}
                className="resize-y font-mono"
            />
        </RailField>
        <RailField label={railInfoLabel("Ask rules", ASK_HINT)}>
            <AntInput.TextArea
                value={value.ask.join("\n")}
                placeholder="Bash(rm:*)"
                rows={2}
                disabled={disabled}
                className="resize-y font-mono"
            />
        </RailField>
        <RailField label={railInfoLabel("Deny rules", DENY_HINT)}>
            <AntInput.TextArea
                value={value.deny.join("\n")}
                placeholder={"Write\nmcp__server__tool"}
                rows={2}
                disabled={disabled}
                className="resize-y font-mono"
            />
        </RailField>
    </Frame>
)

const Live = ({initial, disabled}: {initial?: PermValue; disabled?: boolean}) => {
    const [value, setValue] = useState<Record<string, unknown> | null>(initial ?? null)
    return (
        <div className="max-w-[520px]">
            <Frame>
                <ClaudePermissionsControl value={value} onChange={setValue} disabled={disabled} />
            </Frame>
        </div>
    )
}

/** Populated form — every knob at a non-default value. */
export const Default: Story = {
    args: {value: VALUE, onChange: () => undefined},
    render: () => <Live initial={VALUE} />,
}

/** Unset — mode shows its placeholder, rule lists empty. */
export const Empty: Story = {
    args: {value: null, onChange: () => undefined},
    render: () => <Live />,
}

/** Read-only (a committed revision) — every control takes the disabled skin. */
export const Disabled: Story = {
    args: {value: VALUE, onChange: () => undefined, disabled: true},
    render: () => <Live initial={VALUE} disabled />,
}

/** Schema-driven mode list — the `default_mode` enum arrives inside `anyOf` (Optional[Literal]). */
export const SchemaDrivenModes: Story = {
    args: {value: VALUE, onChange: () => undefined},
    render: () => (
        <div className="max-w-[520px]">
            <Frame>
                <ClaudePermissionsControl
                    value={{...VALUE, default_mode: "plan"}}
                    onChange={() => undefined}
                    modeSchema={{
                        title: "Gate mode",
                        description: "Backend-supplied description for the permission mode.",
                        anyOf: [{enum: ["default", "plan"]}, {type: "null"}],
                    }}
                />
            </Frame>
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
        className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="w-[420px]" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[420px]" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {value: VALUE, onChange: () => undefined},
    render: () => (
        <div className="flex max-w-[1050px] flex-col">
            <Row
                label="populated"
                expected="mode row: antd Select (not typable) → Combobox (typable trigger) — the only allowClear-capable primitive. Resting chrome is the shared selectTriggerVariants, so the closed control is dimensionally identical."
                a={<AntdClaudePermissions />}
                s={
                    <Frame>
                        <ClaudePermissionsControl value={VALUE} onChange={() => undefined} />
                    </Frame>
                }
            />
            <Row
                label="unset / placeholder"
                a={<AntdClaudePermissions value={EMPTY} />}
                s={
                    <Frame>
                        <ClaudePermissionsControl value={null} onChange={() => undefined} />
                    </Frame>
                }
            />
            <Row
                label="disabled"
                a={<AntdClaudePermissions disabled />}
                s={
                    <Frame>
                        <ClaudePermissionsControl
                            value={VALUE}
                            onChange={() => undefined}
                            disabled
                        />
                    </Frame>
                }
            />
        </div>
    ),
}
