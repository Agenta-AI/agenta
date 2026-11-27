import {useState} from "react"

import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: the DrillInView barrel does not re-export this control (its only
// consumer is AgentTemplateControl). Same relative-import convention the @agenta/ui primitive
// stories use for unbarrelled components.
import {ClaudePermissionsControl} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/ClaudePermissionsControl"

// ClaudePermissionsControl — the Claude harness permission knobs (mode + allow/ask/deny rule
// lists) as `RailField` rows.
const meta = {
    title: "@agenta/entity-ui/DrillIn/ClaudePermissionsControl",
    component: ClaudePermissionsControl,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Claude `harness.permissions`: permission mode (clearable `Combobox`) + per-tool allow/ask/deny rule lists (one rule per line).",
            },
        },
    },
} satisfies Meta<typeof ClaudePermissionsControl>

export default meta
type Story = StoryObj<typeof meta>

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

/** The component itself is a fragment of RailField rows, so stories wrap it. */
const Frame = ({children}: {children: React.ReactNode}) => (
    <div className="flex flex-col gap-3">{children}</div>
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

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[420px]">{children}</div>
    </div>
)

export const Variants: Story = {
    args: {value: VALUE, onChange: () => undefined},
    render: () => (
        <div className="flex max-w-[1050px] flex-col">
            <Row label="populated">
                <Frame>
                    <ClaudePermissionsControl value={VALUE} onChange={() => undefined} />
                </Frame>
            </Row>
            <Row label="unset / placeholder">
                <Frame>
                    <ClaudePermissionsControl value={null} onChange={() => undefined} />
                </Frame>
            </Row>
            <Row label="disabled">
                <Frame>
                    <ClaudePermissionsControl value={VALUE} onChange={() => undefined} disabled />
                </Frame>
            </Row>
        </div>
    ),
}
