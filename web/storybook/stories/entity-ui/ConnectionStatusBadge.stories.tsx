import type {ToolConnection} from "@agenta/entities/gatewayTool"
import {ConnectionStatusBadge} from "@agenta/entity-ui/gatewayTool"
import type {Meta, StoryObj} from "@storybook/nextjs"

// ConnectionStatusBadge — the connection state pill.
const meta = {
    title: "@agenta/entity-ui/GatewayTool/ConnectionStatusBadge",
    component: ConnectionStatusBadge,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Connection state pill — Connected / Inactive / Pending, derived from the connection's `is_active`/`is_valid` flags.",
            },
        },
    },
} satisfies Meta<typeof ConnectionStatusBadge>

export default meta
type Story = StoryObj

const conn = (is_active: boolean, is_valid: boolean) =>
    ({
        id: "conn-story",
        slug: "conn-story",
        name: "Story connection",
        provider_key: "composio",
        integration_key: "github",
        flags: {is_active, is_valid},
    }) as unknown as ToolConnection

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row label="connected (active + valid)">
                <ConnectionStatusBadge connection={conn(true, true)} />
            </Row>
            <Row label="inactive">
                <ConnectionStatusBadge connection={conn(false, false)} />
            </Row>
            <Row label="pending (active, not valid)">
                <ConnectionStatusBadge connection={conn(true, false)} />
            </Row>
        </div>
    ),
}
