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
}) => (
    <section className="flex flex-col gap-3">
        <h3 className="m-0 text-sm font-medium">Payment history</h3>
        <div className="border-border/50 flex flex-wrap items-center gap-3 border-0 border-y border-solid py-3">
            <span className="bg-accent flex size-7 shrink-0 items-center justify-center rounded-md">
                <Receipt size={14} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">Invoices and receipts</span>
                <span className="text-muted-foreground text-[13px]">
                    Every subscription and credit pack payment, with its PDF invoice.
                </span>
            </span>
            <Button size="sm" variant="outline" onClick={onOpenPortal} disabled={opening}>
                {opening ? "Opening…" : "View in billing portal"}
                <ArrowSquareOut data-icon="inline-end" />
            </Button>
        </div>
        {error ? <span className="text-destructive text-[13px]">{error}</span> : null}
        <span className="text-muted-foreground text-[13px]">
            Payment method, tax IDs and billing address are managed in the billing portal too.
        </span>
    </section>
)
