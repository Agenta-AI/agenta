import type {WalletCredit, WalletSummary} from "./walletApi"
import {MUSD_PER_CREDIT} from "./walletFormat"

/** Mirrors `DAILY_FREE_GRANTS_PER_MONTH` in api/ee/src/core/wallets/grants.py. */
export const DAILY_FREE_GRANTS_PER_MONTH = 10
export const DAILY_FREE_KIND = "daily_free"
export const LOW_CREDITS_FLOOR_MUSD = 100 * MUSD_PER_CREDIT
export const LOW_CREDITS_RATIO = 0.2

export type CreditAlert =
    | {kind: "none"}
    | {kind: "low"; remainingMusd: number}
    | {kind: "daily"; todayMusd: number | null; refills: boolean}
    | {kind: "empty"}

const isActive = (credit: WalletCredit, now: number) =>
    (!credit.start_time || Date.parse(credit.start_time) <= now) &&
    (!credit.end_time || Date.parse(credit.end_time) > now)

const utcDay = (time: number) => new Date(time).toISOString().slice(0, 10)
const utcMonth = (time: number) => utcDay(time).slice(0, 7)

/** What the wallet says about the next task: fine, running low, on daily credits, or refused. */
export const creditAlert = (
    wallet: WalletSummary | null | undefined,
    now = Date.now(),
): CreditAlert => {
    if (!wallet || wallet.mode !== "enforce") return {kind: "none"}
    // A new organization has no credit rows until its first admission grants the day's credits.
    if (wallet.credits.length === 0) return {kind: "none"}

    const active = wallet.credits.filter((credit) => isActive(credit, now))
    const durable = active.filter((credit) => credit.credit_kind !== DAILY_FREE_KIND)
    const durableRemaining = durable.reduce((sum, c) => sum + Math.max(0, c.remaining_musd), 0)
    const durableTotal = durable.reduce((sum, c) => sum + c.amount_musd, 0)

    const daily = wallet.credits.filter((credit) => credit.credit_kind === DAILY_FREE_KIND)
    const createdOn = (credit: WalletCredit) =>
        credit.created_at ? utcDay(Date.parse(credit.created_at)) : null
    const todayDaily = active.find((credit) => credit.credit_kind === DAILY_FREE_KIND)
    const dailyThisMonth = daily.filter(
        (credit) => createdOn(credit)?.slice(0, 7) === utcMonth(now),
    ).length
    const refills = dailyThisMonth < DAILY_FREE_GRANTS_PER_MONTH
    // The summary never mints the day's grant; the next admission does.
    const grantPending =
        daily.length > 0 && !daily.some((credit) => createdOn(credit) === utcDay(now)) && refills

    // Spendable decides admission, and the credit rows can read fuller than it (a deficit, a floor).
    const spendable = Math.max(0, wallet.spendable_musd ?? 0)
    const todayLeft = Math.max(0, todayDaily?.remaining_musd ?? 0)
    const durableLeft = Math.min(durableRemaining, Math.max(0, spendable - todayLeft))
    if (spendable <= 0)
        return grantPending ? {kind: "daily", todayMusd: null, refills} : {kind: "empty"}
    if (durableLeft <= 0)
        return {kind: "daily", todayMusd: todayDaily?.remaining_musd ?? null, refills}
    if (
        durableTotal > 0 &&
        durableLeft < Math.max(LOW_CREDITS_FLOOR_MUSD, LOW_CREDITS_RATIO * durableTotal)
    )
        return {kind: "low", remainingMusd: durableLeft}
    return {kind: "none"}
}
