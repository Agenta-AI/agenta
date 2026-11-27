import type {ReactNode} from "react"

import {McpServerItemControl} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

// McpServerItemControl — one `agent.mcps[]` entry (a declared external MCP server) as a
// named header over the JSON editor. Rendered without a `SharedEditor` injection, so both
// halves take the documented textarea fallback branch.
const meta = {
    title: "@agenta/entity-ui/DrillIn/McpServerItemControl",
    component: McpServerItemControl,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Schema-driven control for one declared MCP server. Name header + delete control over the raw JSON editor.",
            },
        },
    },
} satisfies Meta<typeof McpServerItemControl>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const SERVER = {
    name: "exa",
    connection: {
        type: "http",
        url: "https://mcp.exa.ai/mcp",
        credentials: {type: "header_secret_refs", headers: {"x-api-key": "exa-key"}},
    },
}

const UNNAMED_SERVER = {connection: {type: "http", url: ""}}

const Row = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <div className="flex-1">{children}</div>
        </div>
    </div>
)

export const Variants: Story = {
    args: {value: SERVER},
    render: () => (
        // Reveals the hover-only remove control.
        <div className="flex max-w-[1100px] flex-col [&_.invisible]:!visible">
            <Row label="named server">
                <McpServerItemControl value={SERVER} onDelete={noop} onChange={noop} />
            </Row>
            <Row label="unnamed server">
                <McpServerItemControl value={UNNAMED_SERVER} onDelete={noop} onChange={noop} />
            </Row>
        </div>
    ),
}

/** Read-only: no delete control, the editor is not writable. */
export const ReadOnly: Story = {
    args: {value: SERVER, disabled: true},
    render: () => (
        <div className="max-w-[520px]">
            <McpServerItemControl value={SERVER} disabled onDelete={noop} />
        </div>
    ),
}
