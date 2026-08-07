import type {ReactNode} from "react"

import {McpServerItemControl} from "@agenta/entity-ui/drill-in"
import {MinusCircle} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton, Tooltip as AntTooltip, Typography as AntTypography} from "antd"

// McpServerItemControl — one `agent.mcps[]` entry (a declared external MCP server) as a
// named header over the JSON editor. Rendered without a `SharedEditor` injection, so both
// halves take the documented textarea fallback branch.
//
// The antd half replays the pre-migration header verbatim from feat/storybook-data-seam.
//
// antd swaps: `Typography.Text strong` → `<span className="font-semibold">` (antd's
// `fontWeightStrong` is 600, i.e. semibold — not `font-medium`); `Tooltip title` → Radix
// Tooltip; icon-only `Button type="text" size="small"` → `variant="ghost" size="icon-sm"`
// with the icon as a child and an explicit `aria-label`.
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

const json = (value: unknown) => JSON.stringify(value, null, 2)

const AntdCard = ({name, value}: {name: string; value: Record<string, unknown>}) => (
    <div className="group/mcp flex flex-col gap-2 border rounded-lg p-3">
        <div className="w-full flex items-center justify-between py-1">
            <AntTypography.Text strong className="text-sm truncate">
                {name}
            </AntTypography.Text>
            <AntTooltip title="Remove">
                <AntButton
                    icon={<MinusCircle size={14} />}
                    type="text"
                    size="small"
                    className="invisible group-hover/mcp:visible shrink-0"
                />
            </AntTooltip>
        </div>
        <textarea
            className="font-mono text-xs p-2 border rounded min-h-[120px] resize-y w-full"
            aria-label="MCP server JSON"
            defaultValue={json(value)}
            readOnly
        />
    </div>
)

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: ReactNode
    s: ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject className="flex-1">
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject className="flex-1">
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {value: SERVER},
    render: () => (
        // Reveals the hover-only remove control on BOTH halves (identical classes).
        <div className="flex max-w-[1100px] flex-col [&_.invisible]:!visible">
            <Row
                label="named server"
                a={<AntdCard name="exa" value={SERVER} />}
                s={<McpServerItemControl value={SERVER} onDelete={noop} onChange={noop} />}
            />
            <Row
                label="unnamed server"
                a={<AntdCard name="MCP server" value={UNNAMED_SERVER} />}
                s={<McpServerItemControl value={UNNAMED_SERVER} onDelete={noop} onChange={noop} />}
            />
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
