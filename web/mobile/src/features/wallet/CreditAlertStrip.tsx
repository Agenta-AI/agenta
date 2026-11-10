import {useEffect, useMemo, useState} from "react"

import {RevealCollapse} from "@agenta/chat/components"
import {providerConnectionsAtom, useVaultSecret} from "@agenta/entities/secret"
import {ProviderDrawer} from "@agenta/entity-ui/secretProvider"
import {isBillingEnabled} from "@agenta/shared/api"
import {atom, useAtom, useAtomValue} from "jotai"

import {RunErrorBuyCreditsDialog} from "../chat/RunErrorBuyCreditsDialog"
import {RunErrorPlansDialog} from "../chat/RunErrorPlansDialog"
import {useProjectPermissionState} from "../context/useProjectPermission"

import {creditAlert, type CreditAlert} from "./creditAlert"
import {
    CreditAlertNotice,
    type CanBuy,
    type CreditAlertAction,
    type ShownAlert,
} from "./CreditAlertNotice"
import {isCreditFunded, type CreditFunding} from "./modelFunding"
import {useModelFunding} from "./useModelFunding"
import {useWalletSummary} from "./useWalletSummary"

/** In memory only, per project: a dismissed alert comes back on reload or when its kind changes. */
const dismissedCreditAlertsAtom = atom<Record<string, CreditAlert["kind"]>>({})

/** The wallet warning above the composer, for agents whose model spends credits. */
export const CreditAlertStrip = ({
    projectId,
    entityId,
    hidden,
    onSwitchModel,
}: {
    projectId: string
    entityId: string
    hidden: boolean
    onSwitchModel: () => void
}) => {
    // On its own key or subscription the agent's model spends no credits, so nothing shows or polls.
    const funding = useModelFunding(entityId)
    const creditFunded = isCreditFunded(funding)
    // A turn in another session can move the balance: poll fast while an alert shows, slowly otherwise.
    const [watching, setWatching] = useState(false)
    const wallet = useWalletSummary(projectId, {
        poll: !creditFunded ? false : watching ? true : 60_000,
    })
    // Judged at the last fetch: an unchanged response keeps `data`, but the date may have moved.
    const fetchedAt = wallet.dataUpdatedAt
    const alert = useMemo(
        () => creditAlert(wallet.data, fetchedAt || Date.now()),
        [wallet.data, fetchedAt],
    )
    useEffect(() => setWatching(alert.kind !== "none"), [alert.kind])
    const billing = useProjectPermissionState(projectId, "edit_billing")
    const canBuy: CanBuy = !isBillingEnabled() ? false : billing.pending ? null : billing.allowed
    const [dismissed, setDismissed] = useAtom(dismissedCreditAlertsAtom)
    const [open, setOpen] = useState<"providers" | "buy-credits" | "plans" | null>(null)
    // Mounted on first use, so the top-up offer is not fetched on every chat load.
    const [billingUsed, setBillingUsed] = useState(false)
    const connections = useAtomValue(providerConnectionsAtom)
    const {mutate} = useVaultSecret()

    // The last alert stays rendered while the strip collapses away.
    const [shown, setShown] = useState<{alert: ShownAlert; funding: CreditFunding} | null>(null)
    useEffect(() => {
        if (alert.kind !== "none" && isCreditFunded(funding)) setShown({alert, funding})
    }, [alert, funding])
    const current = alert.kind !== "none" && isCreditFunded(funding) ? {alert, funding} : shown
    // A model key does not fund agent runtime, so being out of credits shows even beside another strip.
    const visible =
        creditFunded &&
        (!hidden || alert.kind === "empty") &&
        alert.kind !== "none" &&
        dismissed[projectId] !== alert.kind

    const run: Record<CreditAlertAction, () => void> = {
        "switch-model": onSwitchModel,
        "add-key": () => setOpen("providers"),
        buy: () => {
            setBillingUsed(true)
            setOpen("buy-credits")
        },
    }

    return (
        <>
            <RevealCollapse open={visible}>
                {current ? (
                    <div className="pt-2">
                        <CreditAlertNotice
                            alert={current.alert}
                            funding={current.funding}
                            canBuy={canBuy}
                            onAction={(action) => run[action]()}
                            onDismiss={() =>
                                setDismissed({...dismissed, [projectId]: current.alert.kind})
                            }
                        />
                    </div>
                ) : null}
            </RevealCollapse>
            <ProviderDrawer
                open={open === "providers"}
                onClose={() => setOpen(null)}
                context="playground"
                connections={connections}
                onSaved={mutate}
            />
            {canBuy && billingUsed ? (
                <>
                    <RunErrorBuyCreditsDialog
                        projectId={projectId}
                        open={open === "buy-credits"}
                        onOpenChange={(next) => setOpen(next ? "buy-credits" : null)}
                        onUpgrade={() => setOpen("plans")}
                    />
                    <RunErrorPlansDialog
                        projectId={projectId}
                        open={open === "plans"}
                        onOpenChange={(next) => setOpen(next ? "plans" : null)}
                    />
                </>
            ) : null}
        </>
    )
}
