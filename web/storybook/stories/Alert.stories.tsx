import {Alert, Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Primitives/Display/Alert",
    component: Alert,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A banner or inline message with a status type, optional icon, description, close button and trailing action.\n\n**Used in:** nowhere — the `@agenta/ui` Alert has zero call-sites across `web/oss`, `web/ee` and the packages. Low-risk to change.",
            },
        },
    },
} satisfies Meta<typeof Alert>

export default meta
type Story = StoryObj<typeof meta>

// Alerts are block-width, so each row holds a fixed-width box.
const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[320px]">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[560px] flex-col">
            <Row label="success · showIcon">
                <Alert type="success" message="Success message" showIcon />
            </Row>
            <Row label="info · showIcon">
                <Alert type="info" message="Info message" showIcon />
            </Row>
            <Row label="warning · showIcon">
                <Alert type="warning" message="Warning message" showIcon />
            </Row>
            <Row label="error · showIcon">
                <Alert type="error" message="Error message" showIcon />
            </Row>
            <Row label="error · description">
                <Alert
                    type="error"
                    message="Error title"
                    description="A longer description explaining what went wrong."
                    showIcon
                />
            </Row>
            <Row label="closable">
                <Alert type="info" message="Dismissible message" closable />
            </Row>
            <Row label="banner">
                <Alert type="warning" message="Banner message" banner />
            </Row>
            <Row label="plain (no icon)">
                <Alert type="info" message="Plain message" />
            </Row>
        </div>
    ),
}

export const WithAction: Story = {
    parameters: {
        docs: {
            description: {
                story: "`action` renders a trailing control on the alert's own line. It never wraps, so a long message reflows around it instead of pushing it onto a second line.",
            },
        },
    },
    render: () => (
        <div className="flex max-w-[560px] flex-col gap-3">
            <div className="w-[520px]">
                <Alert
                    type="warning"
                    showIcon
                    message="This server's login expired"
                    action={
                        <Button size="sm" variant="outline">
                            Reconnect
                        </Button>
                    }
                />
            </div>
            <div className="w-[520px]">
                <Alert
                    banner
                    type="warning"
                    showIcon
                    message="This server's login expired. Its tools are unavailable until you reconnect."
                    action={
                        <Button size="sm" variant="outline">
                            Reconnect
                        </Button>
                    }
                />
            </div>
            <div className="w-[520px]">
                <Alert
                    type="error"
                    showIcon
                    message="Could not reach the server"
                    description="The address did not resolve, or the server did not answer in time."
                    action={
                        <Button size="sm" variant="outline">
                            Retry
                        </Button>
                    }
                    closable
                />
            </div>
        </div>
    ),
}
