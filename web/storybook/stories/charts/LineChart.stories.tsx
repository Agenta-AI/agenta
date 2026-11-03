import {
    LineChart,
    type LineChartProps,
    type LinePoint,
} from "@agenta/ui/components/presentational/charts"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {ChartStoryFrame} from "./ChartStoryFrame"

const meta = {
    title: "@agenta/ui/Charts/LineChart",
    component: LineChart,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Small SVG line chart over time: one straight line with a light area per series. A null value breaks the line; a lone point draws a dot. Hover or focus the chart and use the arrow keys to read every point.\n\n**Used in:** the evaluation run overview of online runs (metric values over time).",
            },
        },
    },
    render: (args) => (
        <ChartStoryFrame heading={args.title}>
            <LineChart {...args} />
        </ChartStoryFrame>
    ),
} satisfies Meta<LineChartProps>

export default meta
type Story = StoryObj<typeof meta>

const START = Date.UTC(2026, 9, 1, 0, 0)
const HOUR = 60 * 60 * 1000
const formatX = (x: number) =>
    new Date(x).toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit", timeZone: "UTC"})

const hours = (count: number, value: (i: number) => Record<string, number | null>): LinePoint[] =>
    Array.from({length: count}, (_, i) => ({x: START + i * HOUR, values: value(i)}))

const score = [{key: "score", name: "Score"}]

export const OneSeries: Story = {
    args: {
        title: "Average score",
        height: 220,
        series: score,
        formatX,
        points: hours(24, (i) => ({score: 0.6 + 0.2 * Math.sin(i / 3) + (i % 5) * 0.01})),
    },
}

export const BooleanRate: Story = {
    args: {
        title: "Pass rate",
        height: 220,
        series: [{key: "pass", name: "Pass rate"}],
        yDomain: [0, 1],
        formatX,
        points: hours(12, (i) => ({pass: [1, 1, 0.5, 0.75, 1, 0.25, 0.5, 1, 1, 0.75, 0.5, 1][i]})),
    },
}

export const Gaps: Story = {
    args: {
        title: "Latency (s)",
        height: 220,
        series: [{key: "latency", name: "Latency"}],
        formatX,
        points: hours(16, (i) => ({latency: [5, 6, 11].includes(i) ? null : 1.2 + (i % 4) * 0.3})),
    },
}

export const TwoSeries: Story = {
    args: {
        title: "Average score by run",
        height: 220,
        series: [
            {key: "baseline", name: "Baseline"},
            {key: "candidate", name: "Candidate"},
        ],
        formatX,
        points: hours(24, (i) => ({
            baseline: 0.55 + (i % 6) * 0.03,
            candidate: 0.62 + (i % 4) * 0.04,
        })),
    },
}

export const NegativeValues: Story = {
    args: {
        title: "Score change",
        height: 220,
        series: [{key: "delta", name: "Change"}],
        formatX,
        points: hours(12, (i) => ({delta: Math.sin(i / 2) * 0.3})),
    },
}

export const SinglePoint: Story = {
    args: {
        title: "Average score",
        height: 220,
        series: score,
        formatX,
        points: [{x: START, values: {score: 0.74}}],
    },
}

export const Dark: Story = {
    args: TwoSeries.args,
    globals: {theme: "dark"},
}

/** A chart narrower than 160 px: the tooltip stays inside it. */
export const Narrow: Story = {
    args: TwoSeries.args,
    render: (args) => (
        <div className="w-[140px] rounded-lg border border-colorBorderSecondary bg-colorBgContainer p-2">
            <LineChart {...args} />
        </div>
    ),
}
