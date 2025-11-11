import {memo} from "react"

import clsx from "clsx"
import {Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis} from "recharts"

const PLACEHOLDER_DATA = [
    {label: "A", value: 12},
    {label: "B", value: 28},
    {label: "C", value: 20},
    {label: "D", value: 36},
] as const

const BarChartPlaceholder = memo(({className}: {className?: string}) => (
    <div className={clsx("pointer-events-none absolute inset-0", className)}>
        <ResponsiveContainer width="100%" height="100%">
            <BarChart
                data={PLACEHOLDER_DATA as any}
                margin={{top: 24, right: 24, left: 24, bottom: 16}}
            >
                <CartesianGrid stroke="#EAEFF5" strokeDasharray="4 4" />
                <XAxis dataKey="label" tick={false} axisLine={false} />
                <YAxis tick={false} axisLine={false} />
                <Bar dataKey="value" fill="rgba(102, 156, 250, 0.35)" radius={[6, 6, 0, 0]} />
            </BarChart>
        </ResponsiveContainer>
    </div>
))

BarChartPlaceholder.displayName = "BarChartPlaceholder"

export default BarChartPlaceholder
