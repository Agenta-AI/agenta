import type {ToolResult} from "@agenta/entities/gatewayTool"
import {ResultViewer} from "@agenta/entity-ui/gatewayTool"
import type {Meta, StoryObj} from "@storybook/nextjs"

// ResultViewer — read-only tool-execution output.
const meta = {
    title: "@agenta/entity-ui/GatewayTool/ResultViewer",
    component: ResultViewer,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Read-only viewer for a tool execution result: error alert, schema/data-derived fields, or a JSON editor.",
            },
        },
    },
} satisfies Meta<typeof ResultViewer>

export default meta
type Story = StoryObj

const fieldsResult = {
    status: {code: "STATUS_CODE_OK"},
    data: {
        content: JSON.stringify({
            subject: "Weekly report",
            recipient: "team@example.com",
        }),
    },
} as unknown as ToolResult

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="execution error">
                <ResultViewer result={null} error="Connection refused" />
            </Row>
            <Row label="tool status error">
                <ResultViewer
                    result={
                        {
                            status: {code: "STATUS_CODE_FAILED", message: "rate limited"},
                        } as unknown as ToolResult
                    }
                />
            </Row>
            <Row label="read-only fields">
                <ResultViewer result={fieldsResult} />
            </Row>
        </div>
    ),
}

/** Fields derived from the data keys (no output schema) — the common case. */
export const Fields: Story = {
    render: () => (
        <div className="max-w-[520px]">
            <ResultViewer result={fieldsResult} />
        </div>
    ),
}
