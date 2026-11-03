import {
    RadarChart,
    type RadarAxis,
    type RadarChartProps,
} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {ChartStoryFrame} from "./ChartStoryFrame"

const meta = {
    title: "@agenta/ui/Charts/RadarChart",
    component: RadarChart,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Small SVG radar chart: one axis per metric with values normalized to 0..1, one polygon per series. A missing value leaves its vertex out instead of drawing it at zero. Fewer than three axes renders nothing.\n\n**Used in:** the evaluation run overview (all evaluator metrics of one or more runs).",
            },
        },
    },
    render: (args) => (
        <ChartStoryFrame heading={args.title}>
            <RadarChart {...args} />
        </ChartStoryFrame>
    ),
} satisfies Meta<RadarChartProps>

export default meta
type Story = StoryObj<typeof meta>

const axis = (name: string, max: number, values: Record<string, number | null>): RadarAxis => ({
    name,
    max,
    values: Object.fromEntries(
        Object.entries(values).map(([key, raw]) => [
            key,
            raw === null ? null : {raw, normalized: raw / max},
        ]),
    ),
})

const oneRun = [{key: "run", name: "Run A"}]
const twoRuns = [
    {key: "baseline", name: "Baseline"},
    {key: "candidate", name: "Candidate"},
]

const eight = [
    ["Accuracy", 0.82, 0.74],
    ["Relevance", 0.71, 0.8],
    ["Faithfulness", 0.9, 0.86],
    ["Fluency", 0.95, 0.93],
    ["Safety", 0.99, 0.97],
    ["Conciseness", 0.6, 0.72],
    ["Recall", 0.66, 0.58],
    ["Coherence", 0.88, 0.9],
] as const

export const ThreeAxes: Story = {
    args: {
        title: "Run metrics",
        height: 300,
        series: oneRun,
        axes: [
            axis("Accuracy", 1, {run: 0.8}),
            axis("Latency (s)", 4, {run: 1.6}),
            axis("Cost ($)", 0.05, {run: 0.02}),
        ],
    },
}

export const EightAxes: Story = {
    args: {
        title: "Run metrics",
        height: 320,
        series: oneRun,
        axes: eight.map(([name, a]) => axis(name, 1, {run: a})),
    },
}

export const TwoRuns: Story = {
    args: {
        title: "Run comparison",
        height: 320,
        series: twoRuns,
        axes: eight.map(([name, a, b]) => axis(name, 1, {baseline: a, candidate: b})),
    },
}

export const MissingValue: Story = {
    args: {
        title: "Run comparison with a missing metric",
        height: 320,
        series: twoRuns,
        axes: eight
            .slice(0, 5)
            .map(([name, a, b], i) => axis(name, 1, {baseline: a, candidate: i === 2 ? null : b})),
    },
}

export const LongAxisNames: Story = {
    args: {
        title: "Run metrics",
        height: 320,
        series: oneRun,
        axes: [
            axis("Context recall over retrieved passages", 1, {run: 0.7}),
            axis("Answer relevance to the user question", 1, {run: 0.85}),
            axis("Groundedness", 1, {run: 0.6}),
            axis("Tool call argument correctness", 1, {run: 0.9}),
            axis("Latency", 5, {run: 2.1}),
        ],
    },
}

export const TwoAxesRendersNothing: Story = {
    args: {
        title: "Too few metrics",
        height: 300,
        series: oneRun,
        axes: eight.slice(0, 2).map(([name, a]) => axis(name, 1, {run: a})),
    },
}

export const Dark: Story = {
    args: TwoRuns.args,
    globals: {theme: "dark"},
}
