import {NumberedStep} from "@agenta/ui/components/presentational"
import {Input} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Layout/NumberedStep",
    component: NumberedStep,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A wizard-style step primitive: a numbered, bordered step card. Stack multiple with a plain `flex flex-col` wrapper.\n\n**Used in:** nowhere — zero call-sites across `web/oss`, `web/ee` and the packages. Low-risk to change.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[320px]">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row label="title + subtitle + control">
                <NumberedStep number={1} title="Name" subtitle="required">
                    <Input placeholder="Enter a name" />
                </NumberedStep>
            </Row>
            <Row label="title only">
                <NumberedStep number={2} title="Review">
                    <span className="text-xs text-colorTextSecondary">
                        Preview content shown here.
                    </span>
                </NumberedStep>
            </Row>
            <Row label="stacked">
                <div className="flex flex-col grow gap-3">
                    <NumberedStep number={1} title="Name" subtitle="required">
                        <Input placeholder="Enter a name" />
                    </NumberedStep>
                    <NumberedStep number={2} title="Review">
                        {null}
                    </NumberedStep>
                </div>
            </Row>
        </div>
    ),
}
