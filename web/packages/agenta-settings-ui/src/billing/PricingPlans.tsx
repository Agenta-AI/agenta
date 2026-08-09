/**
 * Usage & Billing — the plan chooser.
 *
 * The body of the host's pricing dialog. It renders the catalog and says which card is the
 * current plan; picking one is the host's — checkout, switch and cancel are all its calls.
 */

import {Button, Spinner} from "@agenta/ui/ui"

import type {BillingPlanOption} from "./types"

const CONTACT_URL = "https://cal.com/mahmoud-mabrouk-ogzgey/demo"

const formatPrice = (plan: BillingPlanOption) => {
    if (!plan.price) return "Contact us"
    const prefix = plan.price.base?.starting_at ? "Starts at " : ""
    return `${prefix}$${plan.price.base?.amount} /month`
}

export interface PricingPlansProps {
    plans?: BillingPlanOption[]
    loading?: boolean
    /** Slug of the plan the organization is on. */
    currentPlan?: string | null
    /** Slug of the free tier — it reads "Move to", not "Upgrade to". */
    freePlanSlug?: string | null
    /** On a contact-sales plan every self-serve card is inert. */
    isCurrentPlanCustom?: boolean
    /** Slug whose switch is in flight; the rest go disabled while it runs. */
    pendingPlan?: string | null
    onSelectPlan?: (plan: BillingPlanOption) => void
}

const PricingCard = ({
    plan,
    currentPlan,
    freePlanSlug,
    isCurrentPlanCustom,
    pendingPlan,
    onSelectPlan,
}: {plan: BillingPlanOption} & Omit<PricingPlansProps, "plans" | "loading">) => {
    const isPending = pendingPlan === plan.plan
    const isThisPlanCustom = plan.type === "custom"
    const isThisPlanFree = Boolean(freePlanSlug) && plan.plan === freePlanSlug
    const isCurrent = currentPlan === plan.plan
    // Another card's switch is running, this one is already the plan, or the organization is on
    // a contact-sales plan there is no self-serve way off.
    const isDisabled =
        (Boolean(pendingPlan) && !isPending) || isCurrent || Boolean(isCurrentPlanCustom)

    const action = isThisPlanCustom ? (
        <Button
            variant={isCurrentPlanCustom ? "link" : "default"}
            className="w-full"
            disabled={isDisabled}
            onClick={() => window.open(CONTACT_URL, "_blank")}
        >
            {isCurrentPlanCustom ? "Current plan" : "Talk to us"}
        </Button>
    ) : (
        <Button
            variant={isCurrent ? "link" : isThisPlanFree ? "ghost" : "outline"}
            className="w-full"
            disabled={isDisabled || isPending}
            onClick={() => onSelectPlan?.(plan)}
        >
            {isCurrent
                ? "Current plan"
                : isPending
                  ? "Working…"
                  : isThisPlanFree
                    ? `Move to ${plan.title}`
                    : `Upgrade to ${plan.title}`}
        </Button>
    )

    return (
        <div className="flex w-full flex-col rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer md:w-1/3">
            <div className="border-0 border-b border-solid border-colorBorderSecondary p-3 font-medium text-colorText">
                {plan.title}
            </div>

            <div className="flex h-[300px] flex-1 flex-col gap-1 p-3">
                <span className="text-base font-bold text-colorText">{formatPrice(plan)}</span>
                <span className="text-xs font-medium text-colorText">{plan.description}</span>

                <ul className="mt-2 overflow-auto pl-4">
                    {plan.features?.map((feature, index) => (
                        <li className="text-colorTextSecondary" key={index}>
                            {feature}
                        </li>
                    ))}
                </ul>
            </div>

            <div className="border-0 border-t border-solid border-colorBorderSecondary p-3">
                {action}
            </div>
        </div>
    )
}

export const PricingPlans = ({plans, loading = false, ...cardProps}: PricingPlansProps) => {
    if (loading) {
        return (
            <div className="flex h-[400px] w-full items-center justify-center">
                <Spinner />
            </div>
        )
    }

    return (
        <section className="mx-auto mt-4 flex flex-col gap-2">
            <span className="font-medium text-colorText">Choose your plan</span>
            <div className="flex flex-col gap-4 md:flex-row">
                {plans?.map((plan) => (
                    <PricingCard key={plan.title} plan={plan} {...cardProps} />
                ))}
            </div>
        </section>
    )
}

export default PricingPlans
