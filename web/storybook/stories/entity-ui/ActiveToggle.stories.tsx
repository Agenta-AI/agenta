import {ActiveToggle} from "@agenta/entity-ui/gatewayTrigger"
import type {Meta, StoryObj} from "@storybook/nextjs"

// ActiveToggle — the shared play/pause control for trigger subscriptions, schedules and
// webhooks.
const meta = {
    title: "@agenta/entity-ui/GatewayTrigger/ActiveToggle",
    component: ActiveToggle,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Play/pause lifecycle toggle: a ghost icon button with a tooltip. Shows a spinner while the toggle runs.",
            },
        },
    },
} satisfies Meta<typeof ActiveToggle>

export default meta
type Story = StoryObj<typeof meta>

const resolve = () => Promise.resolve()

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">{children}</div>
    </div>
)

export const Variants: Story = {
    args: {active: true, onToggle: resolve},
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row label="active (Pause)">
                <ActiveToggle active onToggle={resolve} />
            </Row>
            <Row label="paused (Resume)">
                <ActiveToggle active={false} onToggle={resolve} />
            </Row>
            <Row label="disabled">
                <ActiveToggle active disabled onToggle={resolve} />
            </Row>
        </div>
    ),
}
