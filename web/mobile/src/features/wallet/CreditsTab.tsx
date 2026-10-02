import {useMemo} from "react"

import {isBillingEnabled} from "@agenta/shared/api"
import {Button} from "@agenta/ui/ui"
import {useQuery} from "@tanstack/react-query"
import Link from "next/link"

import {WalletUsageEmpty} from "./states/WalletUsageEmpty"
import {WalletUsageError} from "./states/WalletUsageError"
import {WalletUsageSkeleton} from "./states/WalletUsageSkeleton"
import {useWalletSummary} from "./useWalletSummary"
import {fetchWalletUsage, type WalletUsageDay} from "./walletApi"
import {creditKindLabel, formatCredits, formatDate} from "./walletFormat"

const USAGE_DAYS = 30

const isForbidden = (error: unknown): boolean =>
    (error as {response?: {status?: number}} | null)?.response?.status === 403

const Section = ({title, children}: {title: string; children: React.ReactNode}) => (
    <section className="flex flex-col gap-2">
        <h3 className="m-0 text-sm font-medium">{title}</h3>
        {children}
    </section>
)

/** One row per day, newest first, with each category's credits and the day's total. */
const usageRows = (days: WalletUsageDay[]) => {
    const byDay = new Map<string, Map<string, number>>()
    for (const entry of days) {
        const row = byDay.get(entry.day) ?? new Map<string, number>()
        row.set(entry.category, (row.get(entry.category) ?? 0) + entry.amount_musd)
        byDay.set(entry.day, row)
    }
    return [...byDay.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([day, parts]) => ({
            day,
            parts,
            total: [...parts.values()].reduce((sum, musd) => sum + musd, 0),
        }))
}

/**
 * What an organization whose wallet is enforced has left and what it spent: credits remaining,
 * the credits they come from, and credits used per day. The raw wallet data stays in the
 * Usage (debug) tab.
 */
export const CreditsTab = ({projectId, billingURL}: {projectId: string; billingURL: string}) => {
    const summary = useWalletSummary(projectId)
    const usage = useQuery({
        queryKey: ["wallet", "credits-usage", projectId],
        queryFn: () =>
            fetchWalletUsage(projectId, {
                start: new Date(Date.now() - USAGE_DAYS * 86_400_000).toISOString(),
            }),
        enabled: Boolean(projectId),
        refetchInterval: 60_000,
        // The detail is owner-only; a 403 is an answer, not a failure to retry.
        retry: (count, error) => !isForbidden(error) && count < 2,
    })
    const rows = useMemo(() => usageRows(usage.data?.days ?? []), [usage.data])
    const categories = useMemo(
        () => [...new Set((usage.data?.days ?? []).map((day) => day.category))].sort(),
        [usage.data],
    )

    if (summary.isPending) return <WalletUsageSkeleton />
    if (summary.isError) return <WalletUsageError onRetry={() => void summary.refetch()} />

    const wallet = summary.data
    const remaining = Math.max(0, wallet.spendable_musd ?? 0)
    const credits = wallet.credits.filter((credit) => credit.remaining_musd > 0)
    const ownerOnly = isForbidden(usage.error)

    return (
        <div className="flex flex-col gap-8">
            <Section title="Credits remaining">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                        <span className="text-2xl font-medium tabular-nums">
                            {formatCredits(remaining)} credits
                        </span>
                        <span className="text-muted-foreground text-xs">1 credit = $0.01</span>
                    </div>
                    {isBillingEnabled() ? (
                        <Button asChild size="sm" variant="outline">
                            <Link href={billingURL}>Plans and billing</Link>
                        </Button>
                    ) : null}
                </div>
                {credits.length ? (
                    <ul className="m-0 flex list-none flex-col p-0">
                        {credits.map((credit) => (
                            <li
                                key={credit.id}
                                className="border-border flex flex-wrap items-baseline justify-between gap-2 border-t py-2 text-xs"
                            >
                                <span>{creditKindLabel(credit.credit_kind)}</span>
                                <span className="text-muted-foreground tabular-nums">
                                    {formatCredits(credit.remaining_musd)} of{" "}
                                    {formatCredits(credit.amount_musd)} left ·{" "}
                                    {credit.end_time
                                        ? `expires ${formatDate(credit.end_time)}`
                                        : "does not expire"}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : null}
            </Section>

            <Section title={`Credits used, last ${USAGE_DAYS} days`}>
                {ownerOnly ? (
                    <p className="text-muted-foreground m-0 text-xs">
                        Only the organization owner can see where credits were used.
                    </p>
                ) : usage.isPending ? (
                    <WalletUsageSkeleton />
                ) : usage.isError ? (
                    <WalletUsageError onRetry={() => void usage.refetch()} />
                ) : rows.length ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="text-muted-foreground">
                                <tr>
                                    <th className="px-2 py-1.5 text-left font-normal">Day</th>
                                    {categories.map((category) => (
                                        <th
                                            key={category}
                                            className="px-2 py-1.5 text-right font-normal"
                                        >
                                            {category}
                                        </th>
                                    ))}
                                    <th className="px-2 py-1.5 text-right font-normal">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <tr key={row.day} className="border-border border-t">
                                        <td className="px-2 py-1.5">{formatDate(row.day)}</td>
                                        {categories.map((category) => (
                                            <td
                                                key={category}
                                                className="px-2 py-1.5 text-right tabular-nums"
                                            >
                                                {formatCredits(row.parts.get(category) ?? 0)}
                                            </td>
                                        ))}
                                        <td className="px-2 py-1.5 text-right font-medium tabular-nums">
                                            {formatCredits(row.total)}
                                        </td>
                                    </tr>
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
