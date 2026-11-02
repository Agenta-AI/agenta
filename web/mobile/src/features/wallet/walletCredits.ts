import type {WalletCredit, WalletSummary} from "./walletApi"

/** The credits the balance counts: some left, and inside their active window. */
export const activeCredits = (wallet: WalletSummary, now = Date.now()): WalletCredit[] =>
    wallet.credits.filter(
        (credit) =>
            credit.remaining_musd > 0 &&
            (!credit.start_time || Date.parse(credit.start_time) <= now) &&
            (!credit.end_time || Date.parse(credit.end_time) > now),
    )

/** The plan's monthly allowance, when the organization has one running. */
export const monthlyCredit = (wallet: WalletSummary, now = Date.now()): WalletCredit | null =>
    activeCredits(wallet, now).find((credit) => credit.credit_kind === "plan_allowance") ?? null

export type WalletHealth = "active" | "low" | "empty"

/** Low means under a week left at the recent daily pace. */
export const walletHealth = (spendableMusd: number, dailyMusd: number | null): WalletHealth =>
    spendableMusd <= 0 ? "empty" : dailyMusd && spendableMusd / dailyMusd < 7 ? "low" : "active"

/** Today's daily free grant, spent or not; none when the plan no longer mints one. */
export const dailyCredit = (wallet: WalletSummary, now = Date.now()): WalletCredit | null =>
    wallet.credits.find(
        (credit) =>
            credit.credit_kind === "daily_free" &&
            (!credit.end_time || Date.parse(credit.end_time) > now),
    ) ?? null
