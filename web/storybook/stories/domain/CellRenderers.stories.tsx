import {
    TextCellContent,
    JsonCellContent,
    MetricCellContent,
    EvaluatorMetricBar,
} from "@agenta/ui/cell-renderers"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * CellRenderers — lightweight, memoized renderers for table cells (testcases,
 * scenarios, eval metrics). They avoid heavy editors, truncate previews, and
 * format metric values. Shown here with MOCKED cell values.
 */
const meta = {
    title: "@agenta/ui/Domain/CellRenderers",
    component: TextCellContent,
    subcomponents: {JsonCellContent, MetricCellContent, EvaluatorMetricBar},
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Lightweight, memoized renderers for table cells (text, JSON, metrics, distribution bars) used in testcase/scenario/eval grids. Shown here off mocked cell values.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Cell = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="flex flex-col gap-1">
        <span className="text-[11px] text-colorTextTertiary">{label}</span>
        <div className="w-[320px] rounded-md border border-colorBorderSecondary p-3 overflow-hidden">
            {children}
        </div>
    </div>
)

/** TextCellContent — plain text with line/char truncation. */
export const Text: Story = {
    render: () => (
        <div className="flex flex-wrap gap-6">
            <Cell label="short">
                <TextCellContent value="Hello world" />
            </Cell>
            <Cell label="truncated (maxChars=80)">
                <TextCellContent
                    value={"Lorem ipsum dolor sit amet, ".repeat(20)}
                    maxChars={80}
                    maxLines={3}
                />
            </Cell>
        </div>
    ),
}

/** JsonCellContent — raw JSON vs pretty key/value fields. */
export const Json: Story = {
    render: () => {
        const value = {
            id: "run_123",
            status: "success",
            score: 0.92,
            tags: ["a", "b"],
            nested: {latency_ms: 1240},
        }
        return (
            <div className="flex flex-wrap gap-6">
                <Cell label="raw">
                    <JsonCellContent value={value} />
                </Cell>
                <Cell label="pretty">
                    <JsonCellContent value={value} pretty />
                </Cell>
            </div>
        )
    },
}

/** MetricCellContent — numeric, string, categorical (with distribution), loading, empty. */
export const Metrics: Story = {
    render: () => (
        <div className="flex flex-wrap gap-6">
            <Cell label="numeric (cost)">
                <MetricCellContent value={0.0123} metricKey="cost" />
            </Cell>
            <Cell label="numeric (duration)">
                <MetricCellContent value={1240} metricKey="duration" />
            </Cell>
            <Cell label="string">
                <MetricCellContent value="passed" />
            </Cell>
            <Cell label="categorical + distribution">
                <MetricCellContent
                    value={{count: 10, frequencies: {correct: 7, incorrect: 3}}}
                    metricType="array"
                    showDistribution
                />
            </Cell>
            <Cell label="loading">
                <MetricCellContent value={undefined} isLoading />
            </Cell>
            <Cell label="empty">
                <MetricCellContent value={null} />
            </Cell>
        </div>
    ),
}

/** EvaluatorMetricBar — distribution bar built from segments or BasicStats. */
export const MetricBar: Story = {
    render: () => (
        <div className="flex flex-col gap-6">
            <Cell label="two segments">
                <EvaluatorMetricBar
                    segments={[
                        {label: "true", value: 72},
                        {label: "false", value: 28},
                    ]}
                    width={280}
                />
            </Cell>
            <Cell label="multi-category">
                <EvaluatorMetricBar
                    segments={[
                        {label: "excellent", value: 40},
                        {label: "good", value: 35},
                        {label: "poor", value: 25},
                    ]}
                    width={280}
                />
            </Cell>
        </div>
    ),
}
