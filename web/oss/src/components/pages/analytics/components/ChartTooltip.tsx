import {theme} from "antd"

export interface TooltipRow {
    label: string
    value: string
    /** Series swatch color; summary/aux rows (Total, Min, Max) render without a dot. */
    color?: string
}

interface ChartTooltipProps {
    title: string
    rows: TooltipRow[]
}

// Inverted, theme-aware chart tooltip: dark surface in light mode, light in dark. Title
// over right-aligned value rows, a colored swatch per series, neutral text, no border.
const ChartTooltip = ({title, rows}: ChartTooltipProps) => {
    const {token} = theme.useToken()

    return (
        <div
            className="flex min-w-[176px] flex-col gap-1 rounded-lg px-3 py-2.5 shadow-lg"
            style={{
                backgroundColor: token.colorBgContainer,
                color: token.colorText,
                boxShadow: token.boxShadowSecondary,
            }}
        >
            <div className="font-medium">{title}</div>
            <div className="flex flex-col gap-1">
                {rows.map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-6">
                        <span className="flex items-center gap-2">
                            <span
                                className="inline-block h-2.5 w-2.5 rounded-sm"
                                style={row.color ? {backgroundColor: row.color} : undefined}
                            />
                            <span className="opacity-70">{row.label}</span>
                        </span>
                        <span className="tabular-nums">{row.value}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

export default ChartTooltip
