import {useState} from "react"

import {PathSelectorDropdown, type PathSelectorItem} from "@agenta/ui/components/presentational"
import {Database, Lightning, Table} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Select, Typography} from "antd"

const {Text} = Typography

// PathSelectorDropdown — a path picker (wraps the @agenta/ui Combobox) with per-source icons and
// a trailing value-type label. The antd counterpart is an antd Select with grouped options.
const meta = {
    title: "@agenta/ui/Presentational/Forms/PathSelectorDropdown",
    component: PathSelectorDropdown,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A path picker (wraps the @agenta/ui Combobox) with per-source icons and a trailing value-type label. A pure @agenta/ui composite; the antd counterpart is a Select with grouped options.\n\n**Used in:** nowhere — zero call-sites across `web/oss`, `web/ee` and the packages. Low-risk to change.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const paths: PathSelectorItem[] = [
    {path: "output.text", label: "text", valueType: "string", source: "output"},
    {path: "output.tokens", label: "tokens", valueType: "number", source: "output"},
    {path: "testcase.prompt", label: "prompt", valueType: "string", source: "testcase"},
    {path: "meta.model", label: "model", valueType: "string", source: "meta"},
]

// Pre-Combobox source icons (c0771ea8e4^) — raw Tailwind colours, before the token migration.
function sourceIcon(source: string | undefined) {
    switch (source) {
        case "testcase":
            return <Table size={12} className="text-green-600 flex-shrink-0" />
        case "output":
            return <Lightning size={12} className="text-blue-500 flex-shrink-0" />
        default:
            return <Database size={12} className="text-gray-400 flex-shrink-0" />
    }
}

// The antd Select renders the full rich label node in its closed trigger, so plain-string
// options would compare two entirely different contents (c0771ea8e4^ built these nodes).
const antdOptions = paths.map((p) => ({
    value: p.pathString || p.path,
    label: (
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
                {sourceIcon(p.source)}
                <span className="truncate">{p.label}</span>
            </div>
            <Text type="secondary" className="text-xs ml-2">
                {p.valueType || p.type || ""}
            </Text>
        </div>
    ),
}))

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            {/* data-vrt-subject on the sizing box: select/combobox triggers hold an inner input too */}
            <div className="w-[240px]" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[240px]" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

const AgentaDemo = ({allowClear}: {allowClear?: boolean}) => {
    const [value, setValue] = useState<string | undefined>("output.text")
    return (
        <PathSelectorDropdown
            value={value}
            onChange={setValue}
            paths={paths}
            allowClear={allowClear}
        />
    )
}

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            {/* Pre-Combobox default was size="small" with search enabled (c0771ea8e4^). */}
            <Row
                label="default"
                a={
                    <Select
                        className="w-full"
                        defaultValue="output.text"
                        optionFilterProp="label"
                        options={antdOptions}
                        showSearch
                        size="small"
                    />
                }
                s={<AgentaDemo />}
            />
            <Row
                label="allowClear"
                a={
                    <Select
                        allowClear
                        className="w-full"
                        defaultValue="output.text"
                        optionFilterProp="label"
                        options={antdOptions}
                        showSearch
                        size="small"
                    />
                }
                s={<AgentaDemo allowClear />}
            />
        </div>
    ),
}
