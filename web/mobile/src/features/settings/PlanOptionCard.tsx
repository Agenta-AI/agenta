import type {BillingPlanOption} from "@agenta/settings-ui"
import {Button, cn} from "@agenta/ui/ui"
import {Check, Coins} from "@phosphor-icons/react"

import {creditsLine, isRecommended, splitLead} from "./planCatalog"

const CONTACT_URL = "https://cal.com/mahmoud-mabrouk-ogzgey/demo"

/**
 * One plan in the chooser: its price, the credits it grants, what it adds, and the way onto it.
 * The recommended plan is the inverted card; the current plan carries the heavier outline.
 */
export const PlanOptionCard = ({
    plan,
    isCurrent,
    isFree,
    isCurrentPlanCustom,
    pending,
    busy,
    onSelect,
}: {
    plan: BillingPlanOption
    isCurrent: boolean
    /** The free tier reads "Move to", not "Upgrade to". */
    isFree: boolean
    /** On a contact-sales plan every self-serve card is inert. */
    isCurrentPlanCustom: boolean
    /** This card's switch is in flight. */
    pending: boolean
    /** Another card's switch is in flight. */
    busy: boolean
    onSelect: () => void
}) => {
    const recommended = isRecommended(plan)
    const amount = plan.price?.base?.amount
    const credits = creditsLine(plan)
    const {lead, items} = splitLead(plan.features ?? [])
    const muted = recommended
        ? "text-background/60 dark:text-muted-foreground"
        : "text-muted-foreground"

    const action = isCurrent ? (
        <span
            className={cn(
                "flex h-[34px] items-center justify-center rounded-lg border border-dashed text-sm",
                recommended ? "border-background/25 dark:border-border" : "border-border",
                muted,
            )}
        >
            Current plan
        </span>
    ) : plan.type === "custom" || amount == null ? (
        <Button
            variant="outline"
            className="h-[34px] w-full"
            disabled={busy}
            onClick={() => window.open(CONTACT_URL, "_blank")}
        >
            Talk to us
        </Button>
    ) : (
        <Button
            variant={recommended ? "default" : "outline"}
            className={cn(
                "h-[34px] w-full",
                recommended &&
                    "bg-hero-action text-hero-action-foreground hover:bg-hero-action-hover",
            )}
            disabled={busy || pending || isCurrentPlanCustom}
            onClick={onSelect}
        >
            {pending ? "Working…" : isFree ? `Move to ${plan.title}` : `Upgrade to ${plan.title}`}
        </Button>
    )

    return (
        <section
            className={cn(
                "box-border flex min-h-0 flex-col rounded-[14px] p-4",
                recommended
                    ? "bg-foreground text-background dark:bg-accent dark:text-foreground dark:ring-1 dark:ring-hero-action/60"
                    : "bg-card text-card-foreground border border-solid",
                !recommended && (isCurrent ? "border-foreground border-[1.5px]" : "border-border"),
            )}
        >
            <div className="flex min-h-[22px] items-center justify-between gap-2">
                <span className="font-medium">{plan.title}</span>
                {isCurrent ? (
                    <span
                        className={cn(
                            "rounded-full px-2 text-[11px] font-medium leading-5",
                            recommended
                                ? "bg-background text-foreground"
                                : "bg-foreground text-background",
                        )}
                    >
                        Current
                    </span>
                ) : recommended ? (
                    <span className="bg-hero-action text-hero-action-foreground rounded-full px-2 text-[11px] font-medium leading-5">
                        Recommended
                    </span>
                ) : null}
            </div>
            <div className="mt-3 flex items-baseline gap-1.5 whitespace-nowrap">
                <span className="text-[28px] font-semibold leading-[34px] tracking-[-0.02em]">
                    {amount == null ? "Custom" : `$${amount}`}
                </span>
                {amount == null ? null : (
                    <span className={cn("text-[13px]", muted)}>
                        {amount === 0
                            ? "free forever"
                            : plan.price?.base?.starting_at
                              ? "from / month"
                              : "/ month"}
                    </span>
                )}
            </div>
            {credits ? (
                <span
                    className={cn(
                        "mt-3 flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-[13px] font-medium",
                        recommended ? "bg-hero-action/15" : "bg-muted",
                    )}
                >
                    <Coins size={15} className={recommended ? "text-hero-action" : muted} />
                    {credits}
                </span>
            ) : null}
            <span className={cn("mb-2 mt-3.5 min-h-4 text-xs", muted)}>
                {lead ?? (plan.description || "What you get:")}
            </span>
            <ul className="m-0 mb-4 flex min-h-0 flex-1 list-none flex-col gap-2 p-0 lg:overflow-y-auto">
                {items.map((feature) => (
                    <li key={feature} className="flex gap-2 text-[13px] leading-[18px]">
                        <Check
                            size={13}
                            className={cn(
                                "mt-0.5 shrink-0",
                                recommended ? "text-hero-action" : "text-success",
                            )}
                        />
                        {feature}
                    </li>
                ))}
            </ul>
            <div className="shrink-0">{action}</div>
        </section>
    )
}
