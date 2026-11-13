import {useState} from "react"

import {PathSelectorDropdown, type PathSelectorItem} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Forms/PathSelectorDropdown",
    component: PathSelectorDropdown,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A path picker (wraps the @agenta/ui Combobox) with per-source icons and a trailing value-type label. A pure @agenta/ui composite.\n\n**Used in:** nowhere — zero call-sites across `web/oss`, `web/ee` and the packages. Low-risk to change.",
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

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[240px]">{children}</div>
    </div>
)

const Demo = ({allowClear}: {allowClear?: boolean}) => {
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

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            <Row label="default">
                <Demo />
            </Row>
            <Row label="allowClear">
                <Demo allowClear />
            </Row>
        </div>
    ),
}
