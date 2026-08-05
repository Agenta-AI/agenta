import {
    TemplateFormatPicker,
    buildTemplateFormatOptions,
    type TemplateFormat,
} from "@agenta/entity-ui/template-format"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Select as AntSelect} from "antd"

/**
 * Parity story for the antd→@agenta/ui migration of `TemplateFormatPicker`.
 * The antd half reproduces the PRE-migration body exactly (antd `Select`,
 * `size="small"`, `minWidth: 180`, `popupMatchSelectWidth={false}`, options from
 * `buildTemplateFormatOptions`) — verified against
 * `git show feat/storybook-data-seam:web/packages/agenta-entity-ui/src/template-format/TemplateFormatPicker.tsx`.
 */
const meta = {
    title: "@agenta/entity-ui/TemplateFormat/TemplateFormatPicker",
    component: TemplateFormatPicker,
} satisfies Meta<typeof TemplateFormatPicker>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

/** The pre-migration antd body, byte-for-byte in behaviour. */
const AntdPicker = ({value, disabled}: {value: TemplateFormat; disabled?: boolean}) => (
    <AntSelect<TemplateFormat>
        size="small"
        value={value}
        disabled={disabled}
        onChange={noop}
        style={{minWidth: 180}}
        popupMatchSelectWidth={false}
        options={buildTemplateFormatOptions(value)}
    />
)

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_auto_auto] items-center gap-4 py-2 border-b border-colorBorderSecondary">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-colorTextSecondary w-12 shrink-0">antd</span>
            <div className="shrink-0" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-colorTextSecondary w-12 shrink-0">agenta</span>
            <div className="shrink-0" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {onChange: noop},
    render: () => (
        <div className="flex flex-col max-w-[900px]">
            <Row
                label="default (mustache)"
                a={<AntdPicker value="mustache" />}
                s={<TemplateFormatPicker value="mustache" onChange={noop} />}
            />
            <Row
                label="legacy value (curly)"
                a={<AntdPicker value="curly" />}
                s={<TemplateFormatPicker value="curly" onChange={noop} />}
            />
            <Row
                label="disabled"
                a={<AntdPicker value="jinja2" disabled />}
                s={<TemplateFormatPicker value="jinja2" disabled onChange={noop} />}
            />
        </div>
    ),
}
