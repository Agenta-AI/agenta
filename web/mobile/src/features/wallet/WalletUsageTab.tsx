import {useMemo, useState} from "react"

import {Button} from "@agenta/ui/ui"
import {useQuery} from "@tanstack/react-query"

import {cn} from "@/lib/utils"

import {WalletUsageEmpty} from "./states/WalletUsageEmpty"
import {WalletUsageError} from "./states/WalletUsageError"
import {WalletUsageSkeleton} from "./states/WalletUsageSkeleton"
import {useWalletSummary} from "./useWalletSummary"
import {fetchWalletUsage} from "./walletApi"
import {WalletDailyUsageBars} from "./WalletDailyUsageBars"
import {formatDateTime, formatMusd, formatUsdExact} from "./walletFormat"
import {WalletUsageSessionRow} from "./WalletUsageSessionRow"

const RANGES = [
    {label: "24 hours", days: 1},
    {label: "7 days", days: 7},
    {label: "30 days", days: 30},
]

const Tile = ({label, musd}: {label: string; musd: number | null}) => (
    <div className="border-border rounded-md border p-3">
        <div className="text-muted-foreground text-xs">{label}</div>
        <div className="text-sm font-medium tabular-nums">{formatMusd(musd)}</div>
        <div className="text-muted-foreground text-xs tabular-nums">
            {musd === null ? "" : formatUsdExact(musd)}
        </div>
    </div>
)

const Section = ({title, children}: {title: string; children: React.ReactNode}) => (
    <section className="flex flex-col gap-2">
        <h3 className="m-0 text-sm font-medium">{title}</h3>
        {children}
    </section>
)

/** The wallet's raw data for debugging: balances, credits, daily usage, and charges by session. */
export const WalletUsageTab = ({projectId}: {projectId: string}) => {
    const [rangeDays, setRangeDays] = useState(7)
    const summary = useWalletSummary(projectId)
    // The window ends at the server's "now" on every poll; only its start is pinned here.
    const start = useMemo(
        () => new Date(Date.now() - rangeDays * 86_400_000).toISOString(),
        [rangeDays],
    )
    const usage = useQuery({
        queryKey: ["wallet", "usage", projectId, rangeDays],
        queryFn: () => fetchWalletUsage(projectId, {start}),
        enabled: Boolean(projectId),
        refetchInterval: 10_000,
    })

    if (summary.isPending || usage.isPending) return <WalletUsageSkeleton />
    if (summary.isError || usage.isError)
        return (
            <WalletUsageError
                onRetry={() => {
                    void summary.refetch()
                    void usage.refetch()
                }}
            />
        )

    const wallet = summary.data
    const data = usage.data

    return (
        <div className="flex flex-col gap-8">
            <Section title="Balance">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Tile label="Spendable" musd={wallet.spendable_musd} />
                    <Tile label="General balance (raw)" musd={wallet.general_balance_musd} />
                    <Tile label="Floor" musd={wallet.floor_musd} />
                    <Tile
                        label="Active credits, original total"
                        musd={wallet.active_credit_total_musd}
                    />
                </div>
            </Section>

            <Section title="Credits">
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="text-muted-foreground">
                            <tr>
                                {[
                                    "Kind",
                                    "Amount",
                                    "Remaining",
                                    "Priority",
                                    "Created",
                                    "Expires",
                                ].map((label) => (
                                    <th key={label} className="px-2 py-1.5 text-left font-normal">
                                        {label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {wallet.credits.map((credit) => (
                                <tr key={credit.id} className="border-border border-t">
                                    <td className="px-2 py-1.5 font-mono">{credit.credit_kind}</td>
                                    <td className="px-2 py-1.5 tabular-nums">
                                        {formatMusd(credit.amount_musd)}
                                    </td>
                                    <td className="px-2 py-1.5 tabular-nums">
                                        {formatMusd(credit.remaining_musd)} ·{" "}
                                        {formatUsdExact(credit.remaining_musd)}
                                    </td>
                                    <td className="px-2 py-1.5 tabular-nums">{credit.priority}</td>
                                    <td className="px-2 py-1.5">
                                        {formatDateTime(credit.created_at)}
                                    </td>
                                    <td className="px-2 py-1.5">
                                        {credit.end_time
                                            ? formatDateTime(credit.end_time)
                                            : "never"}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Section>

            <div className="flex flex-wrap gap-2">
                {RANGES.map((range) => (
                    <Button
                        key={range.days}
                        size="sm"
                        variant={range.days === rangeDays ? "default" : "outline"}
                        onClick={() => setRangeDays(range.days)}
                    >
                        {range.label}
                    </Button>
                ))}
            </div>

            <Section title="Usage per day, by category">
                {data.days.length ? (
                    <WalletDailyUsageBars days={data.days} />
                ) : (
                    <WalletUsageEmpty />
                )}
            </Section>

            <Section title="Usage by session">
                {data.truncated ? (
                    <p className="text-muted-foreground m-0 text-xs">
                        Only the newest 5,000 charges in this range are shown.
                    </p>
                ) : null}
                {data.sessions.length ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="text-muted-foreground">
                                <tr>
                                    <th className="w-6" />
                                    {[
                                        "Last charge",
                                        "User",
                                        "Agent",
                                        "Session",
                                        "Charges",
                                        "Total",
                                    ].map((label) => (
                                        <th
                                            key={label}
                                            className={cn(
                                                "px-2 py-1.5 font-normal",
                                                label === "Charges" || label === "Total"
                                                    ? "text-right"
                                                    : "text-left",
                                            )}
                                        >
                                            {label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {data.sessions.map((session) => (
                                    <WalletUsageSessionRow
                                        key={`${session.session_id}:${session.user_id}:${session.started_at}`}
                                        session={session}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <WalletUsageEmpty />
                )}
            </Section>
        </div>
    )
}
