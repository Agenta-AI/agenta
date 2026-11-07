import {useT} from "@agenta/i18n"
import billingBillingPaymentsSectionCatalog from "@agenta/i18n/catalogs/billing.billingPaymentsSection"
import {Button} from "@agenta/ui/ui"
import {ArrowSquareOut, Receipt} from "@phosphor-icons/react"

/** Invoices and receipts live in Stripe's portal; this app has no copy of them to list. */
export const BillingPaymentsSection = ({
    onOpenPortal,
    opening,
    error,
}: {
    onOpenPortal: () => void
    opening: boolean
    error: string | null
}) => {
    const t = useT(billingBillingPaymentsSectionCatalog)
    return (
        <section className="flex flex-col gap-3">
            <h3 className="m-0 text-sm font-medium">{t("billing.billingPaymentsSection.title")}</h3>
            <div className="border-border/50 flex flex-wrap items-center gap-3 border-0 border-t border-solid py-3">
                <span className="bg-accent flex size-7 shrink-0 items-center justify-center rounded-md">
                    <Receipt size={14} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">
                        {t("billing.billingPaymentsSection.invoices")}
                    </span>
                    <span className="text-muted-foreground text-[13px]">
                        {t("billing.billingPaymentsSection.invoicesHint")}
                    </span>
                </span>
                <Button size="sm" variant="outline" onClick={onOpenPortal} disabled={opening}>
                    {opening
                        ? t("billing.billingPaymentsSection.opening")
                        : t("billing.billingPaymentsSection.viewPortal")}
                    <ArrowSquareOut data-icon="inline-end" />
                </Button>
            </div>
            {error ? <span className="text-destructive text-[13px]">{error}</span> : null}
            <span className="text-muted-foreground text-[13px]">
                {t("billing.billingPaymentsSection.portalHint")}
            </span>
        </section>
    )
}
