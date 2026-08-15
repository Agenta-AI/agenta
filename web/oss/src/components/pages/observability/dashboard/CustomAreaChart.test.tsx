import {renderToStaticMarkup} from "react-dom/server"
import {beforeEach, describe, expect, it, vi} from "vitest"

const captures = vi.hoisted(() => ({
    areaChartProps: [] as unknown[],
}))

vi.mock("antd", () => ({
    theme: {
        useToken: () => ({
            token: {
                colorTextSecondary: "#667085",
                colorBorderSecondary: "#d0d5dd",
                colorBgElevated: "#ffffff",
                colorBorder: "#d0d5dd",
                borderRadius: 6,
                boxShadowSecondary: "none",
                colorText: "#101828",
            },
        }),
    },
}))

vi.mock("@/oss/lib/hooks/useChartSeries", () => ({
    useChartSeries: () => ["#1677ff", "#52c41a"],
}))

vi.mock("recharts", async () => {
    const React = await import("react")

    return {
        ResponsiveContainer: ({children}: {children?: React.ReactNode}) => <div>{children}</div>,
        AreaChart: (props: {children?: React.ReactNode}) => {
            captures.areaChartProps.push(props)
            return <svg>{props.children}</svg>
        },
        Area: () => null,
        CartesianGrid: () => null,
        Tooltip: () => null,
        XAxis: () => null,
        YAxis: () => null,
    }
})

const {default: CustomAreaChart} = await import("./CustomAreaChart")

beforeEach(() => {
    captures.areaChartProps.length = 0
})

describe("CustomAreaChart", () => {
    it("keeps the chart inside the SVG so wide y-axis labels are not clipped", () => {
        renderToStaticMarkup(
            <CustomAreaChart
                data={[{timestamp: "2026-08-12", latency: 20000}]}
                categories={["latency"]}
                index="timestamp"
                valueFormatter={(value) => `${value}ms`}
            />,
        )

        expect(captures.areaChartProps).toHaveLength(1)
        expect(captures.areaChartProps[0]).toMatchObject({
            margin: {top: 5, right: 5, left: 0, bottom: 0},
        })
    })
})
