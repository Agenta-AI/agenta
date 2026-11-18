import {DropdownButton, type DropdownButtonOption} from "@agenta/ui/components"
import {Play} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Buttons/DropdownButton",
    component: DropdownButton,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A split button (main action + options dropdown) composed from the @agenta/ui Button/LoadingButton and a dropdown menu.\n\n**Used in:** 1 place — the shared playground execution-row actions (`@agenta/playground-ui` `ExecutionItems/assets/ExecutionRow/shared.tsx`).",
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

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row label="default">
                <DropdownButton label="Run" options={options} />
            </Row>
            <Row label="with icon">
                <DropdownButton label="Run" icon={<Play size={14} />} options={options} />
            </Row>
            <Row label="primary variant">
                <DropdownButton label="Run" variant="default" options={options} />
            </Row>
            <Row label="disabled">
                <DropdownButton label="Run" options={options} disabled />
            </Row>
        </div>
    ),
}
