import {BuyCreditsDialog, useTopUpOffer} from "@agenta/settings-ui"

/** The credit-pack picker, opened over the chat; Stripe returns the payer to this page. */
export const RunErrorBuyCreditsDialog = ({
    projectId,
    open,
    onOpenChange,
    onUpgrade,
}: {
    projectId: string
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Where the free plan goes instead: the checkout refuses it a pack. */
    onUpgrade: () => void
}) => {
    const offer = useTopUpOffer({projectId})
    return (
        <BuyCreditsDialog
            open={open}
            onOpenChange={onOpenChange}
            projectId={projectId}
            packs={offer.data?.packs ?? []}
            onUpgrade={onUpgrade}
        />
    )
}
