import {BarChart, type BarChartProps} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {ChartStoryFrame} from "./ChartStoryFrame"

const percent = (value: number) => `${value}%`

const meta = {
    title: "@agenta/ui/Charts/BarChart",
    component: BarChart,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Small SVG bar chart: one group per category, one bar per series. A zero value draws a 2 px stub, a null value draws no bar. Hover or focus the chart and use the arrow keys to read every value.\n\n**Used in:** the evaluation run overview metric cards (histograms, True/False percentages, categorical counts).",
            },
        },
    },
    render: (args) => (
        <ChartStoryFrame heading={args.title}>
            <BarChart {...args} />
        </ChartStoryFrame>
    ),
} satisfies Meta<BarChartProps>

export default meta
type Story = StoryObj<typeof meta>

const count = [{key: "count", name: "Count"}]
const twoRuns = [
    {key: "baseline", name: "Baseline"},
    {key: "candidate", name: "Candidate"},
]

const bins = [
    "0–0.13",
    "0.13–0.25",
    "0.25–0.38",
    "0.38–0.5",
    "0.5–0.63",
    "0.63–0.75",
    "0.75–0.88",
    "0.88–1",
]

export const Numeric: Story = {
    args: {
        title: "Similarity score",
        height: 220,
        series: count,
        data: bins.map((category, i) => ({
            category,
            values: {count: [2, 5, 9, 14, 22, 17, 8, 0][i]},
        })),
    },
}

export const BooleanPercent: Story = {
    args: {
        title: "Exact match",
        height: 220,
        series: [{key: "pct", name: "Percentage"}],
        yMax: 100,
        formatValue: percent,
        data: [
            {category: "True", values: {pct: 72}},
            {category: "False", values: {pct: 28}},
        ],
    },
}

export const Categorical: Story = {
    args: {
        title: "Tone",
        height: 220,
        series: count,
        data: ["Friendly", "Neutral", "Formal", "Curt", "Other"].map((category, i) => ({
            category,
            values: {count: [31, 44, 12, 3, 1][i]},
        })),
    },
}

export const TwoRuns: Story = {
    args: {
        title: "Similarity score by run",
        height: 220,
        series: twoRuns,
        data: bins.slice(0, 5).map((category, i) => ({
            category,
            values: {
                baseline: [4, 9, 15, 11, 6][i],
                candidate: [1, 4, 10, 18, i === 4 ? null : 12][i],
            },
        })),
    },
}

export const LongLabels: Story = {
    args: {
        title: "Failure reason",
        height: 220,
        series: count,
        data: [
            "Answer contradicts the provided context",
            "Missing citation for a factual claim",
            "Response exceeds the length limit",
            "Wrong output format",
        ].map((category, i) => ({category, values: {count: [12, 7, 4, 2][i]}})),
    },
}

export const NegativeValues: Story = {
    args: {
        title: "Score change",
        height: 220,
        series: [{key: "delta", name: "Change"}],
        data: ["Accuracy", "Recall", "Fluency", "Safety"].map((category, i) => ({
            category,
            values: {delta: [0.12, -0.08, 0.03, -0.21][i]},
        })),
    },
}

export const OneCategory: Story = {
    args: {
        title: "Single bin",
        height: 220,
        series: count,
        data: [{category: "1", values: {count: 40}}],
    },
}

export const ZeroValues: Story = {
    args: {
        title: "No hits",
        height: 220,
        series: count,
        data: ["A", "B", "C"].map((category) => ({category, values: {count: 0}})),
    },
}

export const Empty: Story = {
    args: {title: "No data", height: 220, series: count, data: []},
}

export const Dark: Story = {
    args: TwoRuns.args,
    globals: {theme: "dark"},
}

export const Phone: Story = {
    args: Numeric.args,
    render: (args) => (
        <div className="w-[358px]">
            <ChartStoryFrame heading={args.title}>
                <BarChart {...args} />
            </ChartStoryFrame>
        </div>
    ),
}
