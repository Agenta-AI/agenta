import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: the DrillInView barrel does not re-export the glyph.
import {PolicyGlyph} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/PermissionGlyph"

// One glyph map over BOTH vocabularies — the four presets an integration row summarizes, and the
// four per-tool permission values a drawer row sets. A preset and the value it corresponds to must
// never draw differently, which is the whole reason the map is shared; these stories are where
// that is visible.
const meta = {
    title: "@agenta/entity-ui/DrillIn/PermissionGlyph",
    component: PolicyGlyph,
    parameters: {
        docs: {
            description: {
                component:
                    "The permission glyph, used wherever a connection policy is summarized: the " +
                    "integration row, the drawer's default select, a group rollup, and a per-tool " +
                    "select. Bell asks every time, pencil follows the agent policy, circled check " +
                    "allows, slashed circle denies, sliders means per-tool overrides exist.",
            },
        },
    },
} satisfies Meta<typeof PolicyGlyph>

export default meta
type Story = StoryObj<typeof meta>

const Legend = ({
    rows,
}: {
    rows: {value: React.ComponentProps<typeof PolicyGlyph>["value"]; label: string}[]
}) => (
    // `data-vrt-subject` is the harness's readiness marker; without it the a11y run has nothing
    // visible to wait for. This is a showcase, not an antd parity pair — the glyphs are ours.
    <div data-vrt-subject className="flex w-[320px] flex-col gap-3">
        {rows.map(({value, label}) => (
            <div key={value} className="flex items-center gap-3">
                <PolicyGlyph value={value} size={16} />
                <span className="text-xs text-colorTextSecondary">
                    <code>{value}</code> — {label}
                </span>
            </div>
        ))}
    </div>
)

/** The four presets an integration row can summarize, plus Custom. */
export const Presets: Story = {
    args: {value: "always_ask"},
    render: () => (
        <Legend
            rows={[
                {value: "always_ask", label: "asks before every tool"},
                {value: "ask_writes", label: "reads freely, asks to write (the default)"},
                {value: "allow_all", label: "runs every tool without asking"},
                {value: "deny_all", label: "refuses every tool"},
                {value: "custom", label: "per-tool overrides are saved"},
            ]}
        />
    ),
}

/** The four per-tool values. Each shares its preset's glyph, which is the point of one map. */
export const ToolPermissions: Story = {
    args: {value: "inherit"},
    render: () => (
        <Legend
            rows={[
                {value: "inherit", label: "follows the agent policy — same pencil as ask_writes"},
                {value: "ask", label: "asks for this tool — same bell as always_ask"},
                {value: "allow", label: "runs this tool — same check as allow_all"},
                {value: "deny", label: "refuses this tool — same slash as deny_all"},
            ]}
        />
    ),
}

/** Custom is the only amber one: an override is a deviation, and reads as one. */
export const Custom: Story = {
    args: {value: "custom", size: 24},
}
