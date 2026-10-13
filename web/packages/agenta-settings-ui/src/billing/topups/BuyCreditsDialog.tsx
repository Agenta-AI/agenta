import {useEffect, useState} from "react"

import {
    Alert,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    LoadingButton,
    RadioGroup,
} from "@agenta/ui/ui"

import {createTopUpCheckout, type TopUpPack} from "./api"
import {TopUpPackOption} from "./TopUpPackOption"
import {topUpCheckoutError, topUpReturnUrls, type TopUpCheckoutError} from "./topUpRules"

const ERROR_TEXT: Record<Exclude<TopUpCheckoutError, "paid_plan_required">, string> = {
    unavailable: "Credit purchases are not available right now.",
    forbidden: "You do not have permission to buy credits for this organization.",
    failed: "Could not open checkout. Try again.",
}

export interface BuyCreditsDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    projectId: string
    packs: TopUpPack[]
    /** Where the free plan goes instead; the checkout refuses it a pack. */
    onUpgrade?: () => void
}

/**
 * The pack picker. Continuing creates a Stripe Checkout session and moves this tab to it; Stripe
 * sends the payer back to the page they left, which shows the result.
 */
export const BuyCreditsDialog = ({
    open,
    onOpenChange,
    projectId,
    packs,
    onUpgrade,
}: BuyCreditsDialogProps) => {
    const [selected, setSelected] = useState<string | null>(null)
    const [opening, setOpening] = useState(false)
    const [error, setError] = useState<TopUpCheckoutError | null>(null)

    // The first pack is chosen until the person picks one; an error clears on reopen.
    useEffect(() => {
        if (!open) return
        setError(null)
        setSelected((current) =>
            current && packs.some((pack) => pack.code === current)
                ? current
                : (packs[0]?.code ?? null),
        )
    }, [open, packs])

    const expiresAfterDays = packs[0]?.expiresAfterDays

    const openCheckout = async () => {
        if (!selected) return
        setError(null)
        setOpening(true)
        try {
            const urls = topUpReturnUrls(window.location.href)
            const checkoutUrl = await createTopUpCheckout({projectId, pack: selected, ...urls})
            if (!checkoutUrl) {
                setError("failed")
                setOpening(false)
                return
            }
            // This tab, not a popup: a popup after an await is blocked on phones, and the return
            // screen needs this page.
            window.location.assign(checkoutUrl)
        } catch (caught) {
            setError(topUpCheckoutError(caught))
            setOpening(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(next) => (opening ? undefined : onOpenChange(next))}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Buy credits</DialogTitle>
                    <DialogDescription>
                        {expiresAfterDays
                            ? `A one-time payment. Purchased credits expire ${expiresAfterDays} days after purchase.`
                            : "A one-time payment."}
                    </DialogDescription>
                </DialogHeader>

                <RadioGroup
                    value={selected ?? undefined}
                    onValueChange={setSelected}
                    aria-label="Credit pack"
                >
                    {packs.map((pack) => (
                        <TopUpPackOption key={pack.code} pack={pack} disabled={opening} />
                    ))}
                </RadioGroup>

                {error === "paid_plan_required" ? (
                    <Alert
                        type="info"
                        showIcon
                        message="Credit packs are available on paid plans."
                        action={
                            onUpgrade ? (
                                <Button
                                    size="sm"
                                    onClick={() => {
                                        onOpenChange(false)
                                        onUpgrade()
                                    }}
                                >
                                    Upgrade
                                </Button>
                            ) : undefined
                        }
                    />
                ) : error ? (
                    <Alert type="error" showIcon message={ERROR_TEXT[error]} />
                ) : null}

                <DialogFooter>
                    <Button
                        variant="outline"
                        disabled={opening}
                        onClick={() => onOpenChange(false)}
                    >
                        Cancel
                    </Button>
                    <LoadingButton
                        loading={opening}
                        disabled={!selected}
                        onClick={() => void openCheckout()}
                    >
                        {opening ? "Opening checkout…" : "Continue to checkout"}
                    </LoadingButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default BuyCreditsDialog
