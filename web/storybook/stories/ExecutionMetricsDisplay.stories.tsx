import {ExecutionMetricsDisplay, MetaSeparator} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Display/ExecutionMetricsDisplay",
    component: ExecutionMetricsDisplay,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A row of icon badges for latency / tokens / cost, or — in the `plain` variant — one line of dot-separated muted text. Composes the @agenta/ui Badge + Tooltip internally.\n\n**Used in:** the shared generation-result utils behind playground outputs (`badge`), and the turn footer both apps render via `TurnFooter` in `@agenta/chat` (`plain`).",
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
        <div className="flex max-w-[560px] flex-col">
            <Row label="all metrics">
                <ExecutionMetricsDisplay
                    metrics={{durationMs: 1500, totalTokens: 256, totalCost: 0.0012}}
                />
            </Row>
            <Row label="latency only">
                <ExecutionMetricsDisplay metrics={{durationMs: 800}} show={["latency"]} />
            </Row>
            <Row label="small">
                <ExecutionMetricsDisplay
                    metrics={{totalTokens: 256}}
                    size="small"
                    show={["tokens"]}
                />
            </Row>
        </div>
    ),
}

// The turn footer's variant: no badges, no per-metric icons — just the values, dot-separated.
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
            {/* In a meta row: the caller owns the `·` before it, so an empty row leaves none. */}
            <div className="flex items-center gap-1">
                <span className="text-[12px] text-colorTextTertiary">3h ago</span>
                <MetaSeparator className="first:hidden" />
                <ExecutionMetricsDisplay
                    metrics={{durationMs: 46_380, totalTokens: 117_800, totalCost: 0.00891}}
                    variant="plain"
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
