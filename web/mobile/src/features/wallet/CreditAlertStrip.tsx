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
import {useModelFunding} from "./useModelFunding"
import {useWalletSummary} from "./useWalletSummary"

/** In memory only, per project: a dismissed alert comes back on reload or when its kind changes. */
const dismissedCreditAlertsAtom = atom<Record<string, CreditAlert["kind"]>>({})

/** The wallet warning above the composer; low and daily notes yield to another composer strip. */
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
    // A turn in another session can move the balance: poll fast while an alert shows, slowly otherwise.
    const [watching, setWatching] = useState(false)
    const wallet = useWalletSummary(projectId, {poll: watching ? true : 60_000})
    // Judged at the last fetch: an unchanged response keeps `data`, but the date may have moved.
    const fetchedAt = wallet.dataUpdatedAt
    const alert = useMemo(
        () => creditAlert(wallet.data, fetchedAt || Date.now()),
        [wallet.data, fetchedAt],
    )
    useEffect(() => setWatching(alert.kind !== "none"), [alert.kind])
    const funding = useModelFunding(entityId)
    const billing = useProjectPermissionState(projectId, "edit_billing")
    const canBuy: CanBuy = !isBillingEnabled() ? false : billing.pending ? null : billing.allowed
    const [dismissed, setDismissed] = useAtom(dismissedCreditAlertsAtom)
    const [open, setOpen] = useState<"providers" | "buy-credits" | "plans" | null>(null)
    // Mounted on first use, so the top-up offer is not fetched on every chat load.
    const [billingUsed, setBillingUsed] = useState(false)
    const connections = useAtomValue(providerConnectionsAtom)
    const {mutate} = useVaultSecret()

    // The last alert stays rendered while the strip collapses away.
    const [shown, setShown] = useState<ShownAlert | null>(null)
    useEffect(() => {
        if (alert.kind !== "none") setShown(alert)
    }, [alert])
    const current = alert.kind !== "none" ? alert : shown
    // A model key does not fund agent runtime, so being out of credits shows even beside another strip.
    const visible =
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
                            alert={current}
                            funding={funding}
                            canBuy={canBuy}
                            onAction={(action) => run[action]()}
                            onDismiss={() =>
                                setDismissed({...dismissed, [projectId]: current.kind})
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
