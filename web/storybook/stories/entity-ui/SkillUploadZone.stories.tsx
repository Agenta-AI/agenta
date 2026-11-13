import type {ReactNode} from "react"

import {SkillUploadZone} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

// SkillUploadZone — the drop/browse affordance inside SkillFormView's Files rail.
const meta = {
    title: "@agenta/entity-ui/DrillIn/SkillUploadZone",
    component: SkillUploadZone,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Drag a skill folder / .zip / .skill, or browse. Parses the drop into a ParsedSkill and hands it to the host.",
            },
        },
    },
} satisfies Meta<typeof SkillUploadZone>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const Row = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="grid grid-cols-[8rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

export const Variants: Story = {
    args: {onParsed: noop},
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="idle">
                <SkillUploadZone onParsed={noop} />
            </Row>
            <Row label="disabled">
                <SkillUploadZone onParsed={noop} disabled />
            </Row>
        </div>
    ),
}
