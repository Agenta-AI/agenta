import {useEffect, useMemo, useState} from "react"

import {
    BuyCreditsDialog,
    readTopUpReturn,
    SettingsPageActions,
    TOP_UP_QUERY,
    topUpEntry,
    TopUpReturnNotice,
    useTopUpOffer,
    withoutTopUpQuery,
    type TopUpReturn,
} from "@agenta/settings-ui"
import {Button} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"
import {useRouter} from "next/router"

import {isForbidden} from "./walletApi"

/** "Buy credits" where the plan can buy packs, and the notice when Stripe sends the payer back. */
export const CreditsBuyAction = ({
    projectId,
    onUpgrade,
}: {
    projectId: string
    /** Where a checkout refused for the plan sends the payer. */
    onUpgrade: () => void
}) => {
    const router = useRouter()
    const offer = useTopUpOffer({projectId})
    const entry = topUpEntry(offer.data?.status)
    const [shownReturn, setShownReturn] = useState<TopUpReturn>(null)
    const [pickerOpen, setPickerOpen] = useState(false)

    const topUpReturn = useMemo(
        () => readTopUpReturn(router.query),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [router.query[TOP_UP_QUERY.result], router.query[TOP_UP_QUERY.session]],
    )
    const openRequested = router.query[TOP_UP_QUERY.open] === "1"
    const eligible = offer.isSuccess && entry !== null

    const clearQuery = () =>
        void router.replace(
            {pathname: router.pathname, query: withoutTopUpQuery(router.query)},
            undefined,
            {shallow: true},
        )

    // Taken into state, so the notice stays once the URL is cleared.
    useEffect(() => {
        if (!topUpReturn || !eligible) return
        setShownReturn(topUpReturn)
        clearQuery()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eligible, topUpReturn])

    useEffect(() => {
        if (!openRequested || !eligible) return
        if (entry === "buy") setPickerOpen(true)
        clearQuery()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openRequested, eligible, entry])

    const loadFailed = offer.isError && !isForbidden(offer.error)

    return (
        <>
            {entry === "buy" ? (
                <SettingsPageActions>
                    <Button onClick={() => setPickerOpen(true)}>
                        <Plus size={14} />
                        Buy credits
                    </Button>
                </SettingsPageActions>
            ) : null}

            {shownReturn ? (
                <TopUpReturnNotice
                    projectId={projectId}
                    topUpReturn={shownReturn}
                    onClose={() => setShownReturn(null)}
                />
            ) : null}
            {loadFailed ? (
                <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-[13px]">
                    Could not load credit packs.
                    <Button size="sm" variant="outline" onClick={() => void offer.refetch()}>
                        Retry
                    </Button>
                </div>
            ) : null}

            {entry === "buy" ? (
                <BuyCreditsDialog
                    open={pickerOpen}
                    onOpenChange={setPickerOpen}
                    projectId={projectId}
                    packs={offer.data?.packs ?? []}
                    onUpgrade={onUpgrade}
                />
            ) : null}
        </>
    )
}
