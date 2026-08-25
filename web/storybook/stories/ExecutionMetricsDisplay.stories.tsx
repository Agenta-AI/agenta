import {formatCurrency, formatLatency, formatTokens} from "@agenta/shared/utils"
import {ExecutionMetricsDisplay} from "@agenta/ui/components/presentational"
import {Timer, Coins, Hash} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Tag, Tooltip} from "antd"

// ExecutionMetricsDisplay — a row of antd Tags (latency / tokens / cost) with icons. The antd
// original it stands in for is the same row of antd Tags built by hand.
const meta = {
    title: "@agenta/ui/Presentational/Display/ExecutionMetricsDisplay",
    component: ExecutionMetricsDisplay,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A row of icon Tags for latency / tokens / cost, or — in the `plain` variant — one line of dot-separated muted text. Composes the @agenta/ui Badge + Tooltip internally; stands in for the same row of antd Tags built by hand.\n\n**Used in:** the shared generation-result utils behind playground outputs (`badge`), and the turn footer both apps render via `TurnFooter` in `@agenta/chat` (`plain`).",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 text-[10px] text-colorTextSecondary">antd</span>
            {/* data-vrt-subject: a row of tags — crop the whole row, not the first tag */}
            <span data-vrt-subject className="inline-flex">
                {a}
            </span>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 text-[10px] text-colorTextSecondary">agenta</span>
            <span data-vrt-subject className="inline-flex">
                {s}
            </span>
        </div>
    </div>
)

const tagClass = "flex items-center gap-1 m-0"

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[820px] flex-col">
            <Row
                label="all metrics"
                a={
                    <div className="flex items-center gap-1">
                        <Tooltip title={`Duration: ${formatLatency(1.5)}`}>
                            <Tag color="default" className={tagClass}>
                                <Timer size={12} /> {formatLatency(1.5)}
                            </Tag>
                        </Tooltip>
                        <Tooltip title="Total Tokens">
                            <Tag color="default" className={tagClass}>
                                <Hash size={12} /> {formatTokens(256)}
                            </Tag>
                        </Tooltip>
                        <Tooltip title={`Total Cost: ${formatCurrency(0.0012)}`}>
                            <Tag color="default" className={tagClass}>
                                <Coins size={12} /> {formatCurrency(0.0012)}
                            </Tag>
                        </Tooltip>
                    </div>
                }
                s={
                    <ExecutionMetricsDisplay
                        metrics={{durationMs: 1500, totalTokens: 256, totalCost: 0.0012}}
                    />
                }
            />
            <Row
                label="latency only"
                a={
                    <div className="flex items-center gap-1">
                        <Tag color="default" className={tagClass}>
                            <Timer size={12} /> {formatLatency(0.8)}
                        </Tag>
                    </div>
                }
                s={<ExecutionMetricsDisplay metrics={{durationMs: 800}} show={["latency"]} />}
            />
            <Row
                label="small"
                a={
                    <div className="flex items-center gap-1">
                        <Tag color="default" className="m-0 flex items-center gap-1 py-0 text-xs">
                            <Hash size={10} /> {formatTokens(256)}
                        </Tag>
                    </div>
                }
                s={
                    <ExecutionMetricsDisplay
                        metrics={{totalTokens: 256}}
                        size="small"
                        show={["tokens"]}
                    />
                }
            />
        </div>
    ),
}

// The turn footer's variant: no tags, no per-metric icons — just the values, dot-separated.
export const Plain: Story = {
    render: () => (
        <div className="flex max-w-[820px] flex-col gap-3">
            <ExecutionMetricsDisplay
                metrics={{
                    durationMs: 134_000,
                    totalTokens: 1_600_000,
                    promptTokens: 1_500_000,
                    completionTokens: 100_000,
                    totalCost: 0.06951,
                }}
                variant="plain"
            />
            {/* `separator` in context: the leading `·` ties the row to the segment before it. */}
            <div className="flex items-center gap-1">
                <span className="text-[12px] text-colorTextTertiary">3h ago</span>
                <ExecutionMetricsDisplay
                    metrics={{durationMs: 46_380, totalTokens: 117_800, totalCost: 0.00891}}
                    variant="plain"
                    separator
                />
            </div>
            <ExecutionMetricsDisplay
                metrics={{totalTokens: 256}}
                variant="plain"
                show={["tokens"]}
            />
        </div>
    ),
}
