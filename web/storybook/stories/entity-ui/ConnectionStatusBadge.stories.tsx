import type {ToolConnection} from "@agenta/entities/gatewayTool"
import {ConnectionStatusBadge} from "@agenta/entity-ui/gatewayTool"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Tag as AntTag} from "antd"

// ConnectionStatusBadge — the connection state pill. The antd cell replays the
// pre-migration body verbatim (`<Tag color="success"|"default"|"processing">`); the
// agenta cell renders the migrated component (presentational `Tag` tones).
const meta = {
    title: "@agenta/entity-ui/GatewayTool/ConnectionStatusBadge",
    component: ConnectionStatusBadge,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Connection state pill — Connected / Inactive / Pending, derived from the connection's `is_active`/`is_valid` flags. antd `Tag color` → presentational `Tag` tone.",
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

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            {a}
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            {s}
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row
                label="connected (active + valid)"
                a={<AntTag color="success">Connected</AntTag>}
                s={<ConnectionStatusBadge connection={conn(true, true)} />}
            />
            <Row
                label="inactive"
                a={<AntTag color="default">Inactive</AntTag>}
                s={<ConnectionStatusBadge connection={conn(false, false)} />}
            />
            <Row
                label="pending (active, not valid)"
                a={<AntTag color="processing">Pending</AntTag>}
                s={<ConnectionStatusBadge connection={conn(true, false)} />}
            />
        </div>
    ),
}
