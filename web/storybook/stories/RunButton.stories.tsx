import {RunButton} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Buttons/RunButton",
    component: RunButton,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Facade over the @agenta/ui Button with Play / X-circle icons for run and cancel actions.\n\n**Used in:** 3 places, all playground (`@agenta/playground-ui`) — the controls bar, the execution header, and the shared execution-row actions.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[480px] flex-col">
            <Row label="run">
                <RunButton />
            </Row>
            <Row label="cancel (destructive)">
                <RunButton mode="cancel" />
            </Row>
            <Row label="run all">
                <RunButton mode="runAll" />
            </Row>
            <Row label="re-run">
                <RunButton mode="rerun" />
            </Row>
            <Row label="custom label">
                <RunButton label="Evaluate" />
            </Row>
        </div>
    ),
}
