import {useMemo} from "react"

import {cn} from "@/lib/utils"

import type {WalletUsageDay} from "./walletApi"
import {formatMusd, formatUsdExact} from "./walletFormat"

const CATEGORY_CLASSES: Record<string, string> = {
    "Model calls": "bg-primary",
    Tools: "bg-primary/45",
    Sandbox: "bg-muted-foreground/60",
}
const categoryClass = (category: string) => CATEGORY_CLASSES[category] ?? "bg-muted-foreground/30"

/** One stacked bar per day, split by category, scaled to the busiest day in the range. */
export const WalletDailyUsageBars = ({days}: {days: WalletUsageDay[]}) => {
    const {rows, categories, max} = useMemo(() => {
        const byDay = new Map<string, WalletUsageDay[]>()
        for (const day of days) byDay.set(day.day, [...(byDay.get(day.day) ?? []), day])
        const rows = [...byDay.entries()]
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([day, parts]) => ({
                day,
                parts,
                total: parts.reduce((sum, part) => sum + part.amount_musd, 0),
                count: parts.reduce((sum, part) => sum + part.charge_count, 0),
            }))
        return {
            rows,
            categories: [...new Set(days.map((day) => day.category))],
            max: Math.max(1, ...rows.map((row) => row.total)),
        }
    }, [days])

    return (
        <div className="flex flex-col gap-2">
            <div className="text-muted-foreground flex flex-wrap gap-3 text-xs">
                {categories.map((category) => (
                    <span key={category} className="flex items-center gap-1.5">
                        <span className={cn("size-2.5 rounded-sm", categoryClass(category))} />
                        {category}
                    </span>
                ))}
            </div>
            {rows.map((row) => (
                <div
                    key={row.day}
                    className="grid grid-cols-[88px_1fr] items-center gap-3 text-xs md:grid-cols-[88px_1fr_260px]"
                >
                    <span className="text-muted-foreground tabular-nums">{row.day}</span>
                    <div className="bg-muted flex h-4 overflow-hidden rounded-sm">
                        {row.parts.map((part) => (
                            <div
                                key={part.category}
                                className={categoryClass(part.category)}
                                style={{width: `${(part.amount_musd / max) * 100}%`}}
                                title={`${part.category}: ${formatMusd(part.amount_musd)} (${part.charge_count} charges)`}
                            />
                        ))}
                    </div>
                    <span className="col-span-2 tabular-nums md:col-span-1 md:text-right">
                        {formatMusd(row.total)} · {formatUsdExact(row.total)} · {row.count} charges
                    </span>
                </div>
            ))}
        </div>
    )
}
