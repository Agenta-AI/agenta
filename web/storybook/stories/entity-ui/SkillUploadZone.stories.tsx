import type {ReactNode} from "react"

import {SkillUploadZone} from "@agenta/entity-ui/drill-in"
import {cn} from "@agenta/ui/styles"
import {UploadSimple} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton, Spin as AntSpin} from "antd"

// SkillUploadZone — the drop/browse affordance inside SkillFormView's Files rail.
//
// antd swaps: `Spin size="small"` → `Spinner size="small"`; bare antd `Button` (which
// resolves to default-outlined) → `@agenta/ui` `Button variant="outline"`.
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

/** Pre-migration body, verbatim (antd baseline). `busy` renders the Spin branch. */
const AntdZone = ({busy, disabled}: {busy?: boolean; disabled?: boolean}) => (
    <div
        className={cn(
            "flex flex-col items-center justify-center gap-2 rounded border border-dashed px-4 py-5 text-center transition-colors",
            "border-[var(--ag-c-D6DEE6,#d6dee6)]",
            disabled && "opacity-60",
        )}
    >
        {busy ? (
            <AntSpin size="small" />
        ) : (
            <UploadSimple size={20} className="text-[var(--ag-c-586673,#586673)]" />
        )}
        <div className="text-xs text-[var(--ag-c-586673,#586673)]">
            Drag a skill folder, <span className="font-mono">.zip</span>, or{" "}
            <span className="font-mono">.skill</span> here
        </div>
        <AntButton disabled={disabled}>Browse files</AntButton>
    </div>
)

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: ReactNode
    s: ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[8rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject className="flex-1">
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject className="flex-1">
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {onParsed: noop},
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row label="idle" a={<AntdZone />} s={<SkillUploadZone onParsed={noop} />} />
            <Row
                label="disabled"
                a={<AntdZone disabled />}
                s={<SkillUploadZone onParsed={noop} disabled />}
            />
        </div>
    ),
}
