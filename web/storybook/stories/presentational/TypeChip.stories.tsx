import {TypeChip, type ChipVariant} from "@agenta/ui/type-chip"
import type {Meta, StoryObj} from "@storybook/nextjs"

// TypeChip — a small monospace type/state chip (its own inline-styled span/button, not a facade
// over any antd component). Verified: no revision of TypeChip.tsx has ever imported antd, so there
// is no pre-migration baseline to diff against. The antd cell carries the established
// "agenta only, no antd counterpart" caption, which makes the VRT drop the row instead of
// comparing a caption against a real control. This story is legitimately unmeasured.
const meta = {
    title: "@agenta/ui/Presentational/Tags/TypeChip",
    component: TypeChip,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A small monospace type/state chip (its own inline-styled span/button). Pure @agenta/ui component with no antd counterpart.\n\n**Used in:** 7 places — the testcases table shell and its type-chip columns, the testcase data editor, the form view, the vault configure-secret modal, and the playground variable card plus its control adapter.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const AntdOnly = () => (
    <span className="text-[10px] italic text-colorTextSecondary">
        agenta only, no antd counterpart
    </span>
)

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            {a}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            {s}
        </div>
    </div>
)

const primitives: ChipVariant[] = [
    "string",
    "number",
    "boolean",
    "null",
    "json-object",
    "json-array",
]
const hints: ChipVariant[] = ["markdown", "messages", "tool-calls"]
const states: ChipVariant[] = [
    "dotted-key",
    "mixed",
    "collision",
    "shadowed",
    "not-authored",
    "optional",
    "path",
    "unused",
    "draft",
    "chain",
]

export const AgentaOnly: Story = {
    render: () => (
        <div className="flex max-w-[820px] flex-col">
            <Row
                label="primitives"
                a={<AntdOnly />}
                s={primitives.map((v) => (
                    <TypeChip key={v} variant={v} />
                ))}
            />
            <Row
                label="render hints"
                a={<AntdOnly />}
                s={hints.map((v) => (
                    <TypeChip key={v} variant={v} />
                ))}
            />
            <Row
                label="state chips"
                a={<AntdOnly />}
                s={states.map((v) => (
                    <TypeChip key={v} variant={v} />
                ))}
            />
            <Row
                label="clickable"
                a={<AntdOnly />}
                s={<TypeChip variant="string" onClick={() => {}} />}
            />
        </div>
    ),
}
