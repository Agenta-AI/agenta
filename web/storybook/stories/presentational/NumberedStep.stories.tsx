import {NumberedStep} from "@agenta/ui/components/presentational"
import {Input} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Typography as AntTypography} from "antd"

// NumberedStep — a wizard-style step primitive from the layout module: a numbered, bordered step
// card. Stacked with a plain `flex flex-col` wrapper (the old `StepContainer` wrapper was inlined
// away). Migrated off antd `Typography.Text` for the title/subtitle; the antd cell rebuilds that.
const meta = {
    title: "@agenta/ui/Presentational/Layout/NumberedStep",
    component: NumberedStep,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A wizard-style step primitive: a numbered, bordered step card. Stack multiple with a plain `flex flex-col` wrapper. Migrated off antd `Typography.Text` (title/subtitle are plain spans now).\n\n**Used in:** nowhere — zero call-sites across `web/oss`, `web/ee` and the packages. Low-risk to change.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

// `data-vrt-subject` marks the crop box — a step card has no element the generic subject
// list matches, so the harness would otherwise pick the nested <input>.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
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

// Verbatim reproduction of the pre-migration NumberedStep body (`git show HEAD:presentational/
// layout/index.tsx`): identical wrapper classes, but the title/subtitle were antd
// `Typography.Text` (`.ant-typography`) instead of plain spans. `children` are supplied by the
// call site, so both halves get the SAME @agenta/ui control — the pair isolates the step card.
const AntdNumberedStep = ({
    number,
    title,
    subtitle,
    children,
}: {
    number: number
    title: string
    subtitle?: string
    children?: React.ReactNode
}) => (
    // Wrapper classes are byte-identical to the component's (`rounded-lg border border-solid` +
    // `border-zinc-2`, `px-4 py-3`, `gap-3`). `border-solid` is load-bearing: preflight is off, so
    // a bare `border` width utility leaves `border-style: none` and draws nothing. It was added to
    // NumberedStep (a real, user-visible fix) and mirrored here, so the card's border is now
    // visible in BOTH halves.
    <div className="flex flex-col rounded-lg border border-solid px-4 py-3 gap-3 border-zinc-2">
        <div className="flex items-center gap-2">
            <span className="font-medium text-zinc-6">{number}.</span>
            <AntTypography.Text className="font-medium text-sm text-zinc-9">
                {title}
            </AntTypography.Text>
            {subtitle && (
                <AntTypography.Text className="text-zinc-6">{subtitle}</AntTypography.Text>
            )}
        </div>
        {children}
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row
                label="title + subtitle + control"
                a={
                    <AntdNumberedStep number={1} title="Name" subtitle="required">
                        <Input placeholder="Enter a name" />
                    </AntdNumberedStep>
                }
                s={
                    <NumberedStep number={1} title="Name" subtitle="required">
                        <Input placeholder="Enter a name" />
                    </NumberedStep>
                }
            />
            <Row
                label="title only"
                a={
                    <AntdNumberedStep number={2} title="Review">
                        <span className="text-xs text-colorTextSecondary">
                            Preview content shown here.
                        </span>
                    </AntdNumberedStep>
                }
                s={
                    <NumberedStep number={2} title="Review">
                        <span className="text-xs text-colorTextSecondary">
                            Preview content shown here.
                        </span>
                    </NumberedStep>
                }
            />
            <Row
                label="stacked (was StepContainer)"
                a={
                    <div className="flex flex-col grow gap-3">
                        <AntdNumberedStep number={1} title="Name" subtitle="required">
                            <Input placeholder="Enter a name" />
                        </AntdNumberedStep>
                        <AntdNumberedStep number={2} title="Review" />
                    </div>
                }
                s={
                    <div className="flex flex-col grow gap-3">
                        <NumberedStep number={1} title="Name" subtitle="required">
                            <Input placeholder="Enter a name" />
                        </NumberedStep>
                        <NumberedStep number={2} title="Review">
                            {null}
                        </NumberedStep>
                    </div>
                }
            />
        </div>
    ),
}
