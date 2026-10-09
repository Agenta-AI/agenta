import type {BillingPlanOption, BillingSubscription} from "@agenta/settings-ui"
import {Button} from "@agenta/ui/ui"
import {Coins} from "@phosphor-icons/react"

import {formatCredits} from "../wallet/walletFormat"

import {formatDay, periodEnd, planName, planPrice} from "./billingFormat"
import {creditsLine} from "./planCatalog"

const CONTACT_URL = "https://cal.com/mahmoud-mabrouk-ogzgey/demo"

/** The trial's state, else when the plan renews; nothing for a plan that never renews. */
const renewal = (subscription: BillingSubscription | null | undefined, isOnFreePlan: boolean) => {
    const end = periodEnd(subscription)
    if (!end || isOnFreePlan) return null
    if (subscription?.free_trial)
        return end > new Date() ? `Trial ends ${formatDay(end)}` : `Trial ended ${formatDay(end)}`
    return `Renews ${formatDay(end)}`
}

/** The plan the organization is on, what it costs and grants, and the ways to change it. */
export const PlanSummaryCard = ({
    subscription,
    plan,
    monthlyCreditsMusd,
    isOnFreePlan,
    isCustomPlan,
    onChangePlan,
    onCancel,
}: {
    subscription?: BillingSubscription | null
    /** The catalog's entry for the current plan, for its title and price. */
    plan?: BillingPlanOption | null
    /** The plan's monthly credit grant, where the wallet runs one. */
    monthlyCreditsMusd: number | null
    isOnFreePlan: boolean
    isCustomPlan: boolean
    onChangePlan?: () => void
    onCancel?: () => void
}) => {
    const name = plan?.title ?? planName(subscription?.plan) ?? "—"
    const renews = renewal(subscription, isOnFreePlan)

    const price = planPrice(plan)
    // The wallet's live grant wins; the catalog's line covers plans the wallet does not grant.
    const credits = monthlyCreditsMusd
        ? `${formatCredits(monthlyCreditsMusd)} credits a month`
        : plan
          ? creditsLine(plan)
          : null

    // Scoped to `.dark` so the card reads as the design's dark spotlight in both themes.
    return (
        <section className="dark bg-card text-foreground ring-border relative box-border flex min-h-[176px] min-w-0 flex-col gap-3 overflow-hidden rounded-2xl px-5 py-[18px] ring-1 ring-inset">
            <span
                aria-hidden
                className="pointer-events-none absolute -right-[120px] -top-[160px] size-[380px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--color-hero-action)_16%,transparent),transparent)]"
            />
            <div className="relative flex items-center justify-between gap-3">
                <span className="text-muted-foreground text-[13px]">Current plan</span>
                {renews ? (
                    <span className="text-muted-foreground truncate text-xs">{renews}</span>
                ) : null}
            </div>
            <div className="relative flex min-w-0 flex-wrap items-baseline gap-x-2.5">
                <span className="truncate text-[30px] font-semibold capitalize leading-9 tracking-[-0.02em]">
                    {name}
                </span>
                {price ? <span className="text-muted-foreground">{price}</span> : null}
            </div>
            {credits ? (
                <span className="bg-hero-action/15 text-hero-action relative inline-flex h-[26px] items-center gap-1.5 self-start whitespace-nowrap rounded-full px-2.5 text-[13px]">
                    <Coins size={14} />
                    {credits}
                </span>
            ) : null}
            {isCustomPlan ? (
                <a
                    href={CONTACT_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground relative mt-auto text-[13px]"
                >
                    Contact us about your plan
                </a>
            ) : onChangePlan ? (
                <div className="relative mt-auto flex flex-wrap items-center gap-3.5">
                    <Button
                        size="sm"
                        className="bg-foreground text-background hover:bg-foreground/90"
                        onClick={onChangePlan}
                    >
                        {isOnFreePlan ? "Upgrade plan" : "Change plan"}
                    </Button>
                    {!isOnFreePlan && onCancel ? (
                        <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground cursor-pointer border-0 bg-transparent p-0 text-[13px]"
                            onClick={onCancel}
                        >
                            Cancel subscription
                        </button>
                    ) : null}
                </div>
            ) : null}
        </section>
    )
}
