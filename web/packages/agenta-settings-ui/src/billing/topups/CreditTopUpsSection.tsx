import {useEffect, useState, type ReactNode} from "react"

import {Button, cn} from "@agenta/ui/ui"

import {BuyCreditsDialog} from "./BuyCreditsDialog"
import {TopUpReturnNotice} from "./TopUpReturnNotice"
import {topUpEntry, type TopUpReturn} from "./topUpRules"
import {useTopUpOffer} from "./useTopUpOffer"

export interface CreditTopUpsSectionProps {
    projectId: string
    /** The way to a paid plan, for an organization the checkout refuses a pack. */
    onUpgrade?: () => void
    /** The Stripe return the host read off its URL (`readTopUpReturn`). */
    topUpReturn: TopUpReturn
    /** The host's URL asked for the picker (a "Buy credits" button elsewhere links here). */
    openPicker?: boolean
    /** Called once the return or the picker request is taken in: the host clears its URL. */
    onQueryHandled?: () => void
    /** A card like the billing page's sections, or a plain block for a tab with its own. */
    framed?: boolean
    /**
     * Say so when the packs fail to load. Only for a host that already knows the wallet is
     * enforced (the Credits tab exists only then); elsewhere a failed answer shows nothing,
     * because it cannot tell an enforced organization from one that must see no change.
     */
    showLoadError?: boolean
}

/**
 * Buying credit packs: the entry (the picker for a paid plan, the upgrade path for the free
 * plan, nothing where purchases are off), and the result of a checkout the payer came back from.
 * Shared by both apps; each host passes only its URL state and its upgrade path.
 */
export const CreditTopUpsSection = ({
    projectId,
    onUpgrade,
    topUpReturn,
    openPicker = false,
    onQueryHandled,
    framed = false,
    showLoadError = false,
}: CreditTopUpsSectionProps) => {
    const offer = useTopUpOffer({projectId})
    const entry = topUpEntry(offer.data?.status)
    const [shownReturn, setShownReturn] = useState<TopUpReturn>(null)
    const [pickerOpen, setPickerOpen] = useState(false)

    // Taken into state, so the notice stays once the host clears the URL.
    useEffect(() => {
        if (!topUpReturn) return
        setShownReturn(topUpReturn)
        onQueryHandled?.()
        // Only a new return counts; the callback's identity does not.
    }, [topUpReturn?.result, topUpReturn?.result === "success" ? topUpReturn.sessionId : null])

    useEffect(() => {
        if (!openPicker || offer.isPending) return
        if (entry === "buy") setPickerOpen(true)
        onQueryHandled?.()
    }, [openPicker, offer.isPending, entry])

    const notice = shownReturn ? (
        <TopUpReturnNotice
            projectId={projectId}
            topUpReturn={shownReturn}
            onClose={() => setShownReturn(null)}
        />
    ) : null

    // Nothing unless the organization can buy a pack or is offered the upgrade, which the API
    // answers only for an organization whose wallet is enforced. Organizations with the wallet
    // off or in shadow see no change at all, not even a return notice from a crafted URL. A 403
    // (no billing access) shows nothing either. Nothing while the answer is out: most pages that
    // mount this never show it, so a placeholder would only flash.
    const forbidden =
        (offer.error as {response?: {status?: number}} | null)?.response?.status === 403
    const loadFailed = showLoadError && offer.isError && !forbidden
    if (!loadFailed && (!offer.isSuccess || entry === null)) return null

    let body: ReactNode = null
    if (loadFailed) {
        body = (
            <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-colorTextSecondary">
                    Could not load credit packs.
                </span>
                <Button size="sm" variant="outline" onClick={() => void offer.refetch()}>
                    Retry
                </Button>
            </div>
        )
    } else if (entry === "buy") {
        const days = offer.data?.packs[0]?.expiresAfterDays
        body = (
            <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-colorTextSecondary">
                    {days
                        ? `One-time credit packs. Purchased credits expire ${days} days after purchase.`
                        : "One-time credit packs."}
                </span>
                <Button size="sm" onClick={() => setPickerOpen(true)}>
                    Buy credits
                </Button>
            </div>
        )
    } else if (entry === "upgrade") {
        body = (
            <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-colorTextSecondary">
                    Credit packs are available on paid plans.
                </span>
                {onUpgrade ? (
                    <Button size="sm" variant="outline" onClick={onUpgrade}>
                        Upgrade
                    </Button>
                ) : null}
            </div>
        )
    }

    return (
        <section
            className={cn(
                "flex w-full flex-col gap-2",
                framed && "items-stretch rounded-lg bg-colorFillQuaternary p-4",
            )}
        >
            {framed ? (
                <span className="text-xs font-medium text-colorText">Buy credits</span>
            ) : (
                <h3 className="m-0 text-sm font-medium">Buy credits</h3>
            )}
            {notice}
            {body}
            {entry === "buy" ? (
                <BuyCreditsDialog
                    open={pickerOpen}
                    onOpenChange={setPickerOpen}
                    projectId={projectId}
                    packs={offer.data?.packs ?? []}
                    onUpgrade={onUpgrade}
                />
            ) : null}
        </section>
    )
}

export default CreditTopUpsSection
