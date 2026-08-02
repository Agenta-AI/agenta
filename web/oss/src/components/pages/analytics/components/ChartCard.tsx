import {useMemo, useState, type ReactNode} from "react"

import {Card, Typography} from "antd"

import GhostChart from "./GhostChart"

export interface ChartSeries {
    key: string
    label: string
    color: string
}

interface ChartCardProps {
    title: string
    description: string
    series: ChartSeries[]
    hasData: boolean
    /** Rendered with the currently-visible series keys (legend toggles them). */
    children: (activeKeys: string[]) => ReactNode
}

// Reusable chart-card shell: title, one-line description, a toggleable legend,
// and an empty state. Phase 5's Tools/Models cards drop in through this shell.
const ChartCard = ({title, description, series, hasData, children}: ChartCardProps) => {
    const [hidden, setHidden] = useState<Set<string>>(new Set())

    const activeKeys = useMemo(
        () => series.filter((s) => !hidden.has(s.key)).map((s) => s.key),
        [series, hidden],
    )

    const toggle = (key: string) =>
        setHidden((prev) => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            // Keep at least one series visible.
            else if (next.size < series.length - 1) next.add(key)
            return next
        })

    return (
        <Card
            className="[&_.ant-card-body]:p-5 [&_.ant-card-body]:flex [&_.ant-card-body]:flex-col [&_.ant-card-body]:gap-4"
            styles={{body: {height: "100%"}}}
        >
            <div className="flex flex-col gap-0.5 min-w-0">
                <Typography.Text className="font-semibold text-sm">{title}</Typography.Text>
                <Typography.Text className="text-colorTextSecondary">{description}</Typography.Text>
            </div>
            <div className="h-[220px] w-full">
                {hasData ? children(activeKeys) : <GhostChart />}
            </div>
            {series.length > 1 && hasData ? (
                <div className="flex items-center gap-5 pt-5 border-0 border-t border-solid border-colorBorderSecondary">
                    {series.map((s) => {
                        const off = hidden.has(s.key)
                        return (
                            <button
                                key={s.key}
                                type="button"
                                onClick={() => toggle(s.key)}
                                className={`flex items-center gap-2 appearance-none border-none bg-transparent p-0 cursor-pointer transition-opacity ${
                                    off ? "opacity-40 text-colorTextSecondary" : "text-colorText"
                                }`}
                            >
                                <span
                                    className="inline-block w-2.5 h-2.5 rounded-sm"
                                    style={{backgroundColor: s.color}}
                                />
                                {s.label}
                            </button>
                        )
                    })}
                </div>
            ) : null}
        </Card>
    )
}

export default ChartCard
