import {useT} from "@agenta/i18n"
import billingPlanOptionCardCatalog from "@agenta/i18n/catalogs/billing.planOptionCard"
import commonCatalog from "@agenta/i18n/catalogs/common"
import type {BillingPlanOption} from "@agenta/settings-ui"
import {Button, cn} from "@agenta/ui/ui"
import {Check, Coins} from "@phosphor-icons/react"

import {CONTACT_URL} from "./billingFormat"
import {creditsLine, splitLead} from "./planCatalog"

/** One plan in the chooser; the recommended plan is inverted, the current one outlined. */
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
    const t = useT(billingPlanOptionCardCatalog, commonCatalog)
    const recommended = plan.recommended === true
    const amount = plan.price?.base?.amount
    const credits = creditsLine(plan)
    const {lead, items} = splitLead(plan.features ?? [])
    const muted = recommended
        ? "text-background/60 dark:text-muted-foreground"
        : "text-muted-foreground"

    const action = isCurrent ? (
        <span
            className={cn(
                "flex h-control items-center justify-center rounded-md border border-dashed text-label",
                recommended ? "border-background/25 dark:border-border" : "border-border",
                muted,
            )}
        >
            {t("billing.planOptionCard.currentPlan")}
        </span>
    ) : plan.type === "custom" || amount == null ? (
        <Button
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() => window.open(CONTACT_URL, "_blank")}
        >
            {t("billing.planOptionCard.talkToUs")}
        </Button>
    ) : (
        <Button
            variant={recommended ? "brand" : "outline"}
            className="w-full"
            disabled={busy || pending || isCurrentPlanCustom}
            onClick={onSelect}
        >
            {pending
                ? t("common.working")
                : isFree
                  ? t("billing.planOptionCard.moveTo", {plan: plan.title})
                  : t("billing.planOptionCard.upgradeTo", {plan: plan.title})}
        </Button>
    )

    return (
        <section
            className={cn(
                "box-border flex min-h-0 flex-col rounded-lg p-4",
                recommended
                    ? "bg-foreground text-background dark:bg-accent dark:text-foreground dark:ring-1 dark:ring-brand/60"
                    : "bg-card text-card-foreground border border-solid",
                !recommended && (isCurrent ? "border-foreground border" : "border-border"),
            )}
        >
            <div className="flex min-h-5.5 items-center justify-between gap-2">
                <span className="font-medium">{plan.title}</span>
                {isCurrent ? (
                    <span
                        className={cn(
                            "rounded-sm px-2 text-caption leading-5",
                            recommended
                                ? "bg-background text-foreground"
                                : "bg-foreground text-background",
                        )}
                    >
                        {t("billing.planOptionCard.current")}
                    </span>
                ) : recommended ? (
                    <span className="bg-brand text-brand-foreground rounded-sm px-2 text-caption leading-5">
                        {t("billing.planOptionCard.recommended")}
                    </span>
                ) : null}
            </div>
            <div className="mt-3 flex items-baseline gap-1.5 whitespace-nowrap">
                <span className="text-heading">
                    {amount == null ? t("billing.planOptionCard.custom") : `$${amount}`}
                </span>
                {amount == null ? null : (
                    <span className={cn("text-label", muted)}>
                        {amount === 0
                            ? t("billing.planOptionCard.freeForever")
                            : plan.price?.base?.starting_at
                              ? t("billing.planOptionCard.fromPerMonth")
                              : t("billing.planOptionCard.perMonth")}
                    </span>
                )}
            </div>
            {credits ? (
                <span
                    className={cn(
                        "mt-3 flex items-center gap-2 rounded-md px-2.5 py-2 text-label",
                        recommended ? "bg-brand/15" : "bg-secondary",
                    )}
                >
                    <Coins size={16} className={muted} />
                    {credits}
                </span>
            ) : null}
            <span className={cn("mb-2 mt-3 min-h-4 text-meta", muted)}>
                {lead ?? (plan.description || t("billing.planOptionCard.whatYouGet"))}
            </span>
            <ul className="m-0 mb-4 flex flex-1 list-none flex-col gap-2 p-0">
                {items.map((feature) => (
                    <li key={feature} className="flex gap-2 text-label">
                        <Check
                            size={14}
                            className={cn("mt-0.5 shrink-0", muted)}
                        />
                        {feature}
                    </li>
                ))}
            </ul>
            <div className="shrink-0">{action}</div>
        </section>
    )
}
