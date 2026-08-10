import {DropdownButton, type DropdownButtonOption} from "@agenta/ui/components"
import {DownOutlined} from "@ant-design/icons"
import {Play} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton, Dropdown, Space} from "antd"

// DropdownButton — a split button (main action + options dropdown) composed from the @agenta/ui
// Button/LoadingButton and an antd Dropdown for the menu. The antd original it replaces is an
// antd `Space.Compact` joining two antd Buttons with a Dropdown.
const meta = {
    title: "@agenta/ui/Presentational/Buttons/DropdownButton",
    component: DropdownButton,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A split button (main action + options dropdown) composed from the @agenta/ui Button/LoadingButton and an antd Dropdown. Replaces an antd Space.Compact joining two Buttons with a Dropdown.\n\n**Used in:** 1 place — the shared playground execution-row actions (`@agenta/playground-ui` `ExecutionItems/assets/ExecutionRow/shared.tsx`).",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const options: DropdownButtonOption[] = [
    {key: "run", label: "Run"},
    {key: "run-debug", label: "Run with debug"},
    {key: "run-all", label: "Run all"},
]

const menuItems = options.map((o) => ({key: o.key, label: o.label}))

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        {/* data-vrt-subject is REQUIRED: a split button is two <button>s, and the harness's
            subjectIn() uses querySelector, which returns the document-order-FIRST match — the
            main button. Without this the chevron segment was never in the crop, and every row
            reported 0.00% while the two chevrons visibly differed. */}
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <span data-vrt-subject className="inline-flex">
                {a}
            </span>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <span data-vrt-subject className="inline-flex">
                {s}
            </span>
        </div>
    </div>
)

const AntdSplit = ({disabled, icon}: {disabled?: boolean; icon?: React.ReactNode}) => (
    <Space.Compact>
        <AntButton disabled={disabled} icon={icon}>
            Run
        </AntButton>
        <Dropdown menu={{items: menuItems}} trigger={["hover"]} disabled={disabled}>
            <AntButton disabled={disabled} icon={<DownOutlined style={{fontSize: 10}} />} />
        </Dropdown>
    </Space.Compact>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row
                label="default"
                a={<AntdSplit />}
                s={<DropdownButton label="Run" options={options} />}
            />
            {/* Opted out of the pixel gate for the leading icon's VERTICAL position only — see
                CopyButton.stories.tsx for the antd `resetIcon()` derivation: `.ant-btn-icon > svg`
                gets `vertical-align: -0.125em` and `.ant-btn` keeps `line-height: normal`, so
                antd's glyph lands 0.75px above the button's geometric centre. We centre exactly. */}
            <Row
                label="with icon — 0.75px icon lift not reproduced (antd is off-centre)"
                a={<AntdSplit icon={<Play size={14} />} />}
                s={<DropdownButton label="Run" icon={<Play size={14} />} options={options} />}
            />
            <Row
                label="primary variant"
                a={
                    <Space.Compact>
                        <AntButton type="primary">Run</AntButton>
                        <Dropdown menu={{items: menuItems}} trigger={["hover"]}>
                            <AntButton
                                type="primary"
                                icon={<DownOutlined style={{fontSize: 10}} />}
                            />
                        </Dropdown>
                    </Space.Compact>
                }
                s={<DropdownButton label="Run" variant="default" options={options} />}
            />
            <Row
                label="disabled"
                a={<AntdSplit disabled />}
                s={<DropdownButton label="Run" options={options} disabled />}
            />
        </div>
    ),
}
