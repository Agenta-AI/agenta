import {useMemo, useState, type ReactNode} from "react"

import {Card, Typography} from "antd"

import GhostChart from "./GhostChart"

export interface ChartSeries {
    key: string
    label: string
    color: string
}

// A card distinguishes real data from three empty reasons so a zero is never
// mistaken for "no data" or "the query died". See data-contract.md.
export type ChartState = "data" | "no-data" | "unavailable" | "failed"

interface ChartCardProps {
    title: string
    description: string
    series: ChartSeries[]
    state: ChartState
    /** Overrides the default overlay copy for the `unavailable` (coverage) state. */
    unavailableMessage?: string
    /** Rendered with the currently-visible series keys (legend toggles them). */
    children: (activeKeys: string[]) => ReactNode
}

const OVERLAY_COPY: Record<Exclude<ChartState, "data">, {title: string; subtitle: string}> = {
    "no-data": {
        title: "No data to show",
        subtitle: "No runs match the current time range and filters.",
    },
    unavailable: {
        title: "Not available",
        subtitle: "This metric isn't available for the selected window.",
    },
    failed: {
        title: "Couldn't load this chart",
        subtitle: "The request failed. Change the range or try again.",
    },
}

// Reusable chart-card shell: title, one-line description, a toggleable legend, and
// the four page states. Breakdown cards drop in through this same shell.
const ChartCard = ({
    title,
    description,
    series,
    state,
    unavailableMessage,
    children,
}: ChartCardProps) => {
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

    const hasData = state === "data"
    const overlay = hasData ? null : OVERLAY_COPY[state]
    const subtitle =
        state === "unavailable" && unavailableMessage ? unavailableMessage : overlay?.subtitle

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
                {hasData ? (
                    children(activeKeys)
                ) : (
                    <GhostChart title={overlay?.title} subtitle={subtitle} />
                )}
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
