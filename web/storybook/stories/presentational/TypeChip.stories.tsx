import {TypeChip, type ChipVariant} from "@agenta/ui/type-chip"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Tags/TypeChip",
    component: TypeChip,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A small monospace type/state chip (its own inline-styled span/button). Pure @agenta/ui component.\n\n**Used in:** 7 places — the testcases table shell and its type-chip columns, the testcase data editor, the form view, the vault configure-secret modal, and the playground variable card plus its control adapter.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-wrap items-center gap-1.5">{children}</div>
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

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[820px] flex-col">
            <Row label="primitives">
                {primitives.map((v) => (
                    <TypeChip key={v} variant={v} />
                ))}
            </Row>
            <Row label="render hints">
                {hints.map((v) => (
                    <TypeChip key={v} variant={v} />
                ))}
            </Row>
            <Row label="state chips">
                {states.map((v) => (
                    <TypeChip key={v} variant={v} />
                ))}
            </Row>
            <Row label="clickable">
                <TypeChip variant="string" onClick={() => {}} />
            </Row>
        </div>
    ),
}
