import {TemplateFormatPicker} from "@agenta/entity-ui/template-format"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/entity-ui/TemplateFormat/TemplateFormatPicker",
    component: TemplateFormatPicker,
} satisfies Meta<typeof TemplateFormatPicker>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

export const Variants: Story = {
    args: {onChange: noop},
    render: () => (
        <div className="flex flex-col max-w-[640px]">
            <Row label="default (mustache)">
                <TemplateFormatPicker value="mustache" onChange={noop} />
            </Row>
            <Row label="legacy value (curly)">
                <TemplateFormatPicker value="curly" onChange={noop} />
            </Row>
            <Row label="disabled">
                <TemplateFormatPicker value="jinja2" disabled onChange={noop} />
            </Row>
        </div>
    ),
}
