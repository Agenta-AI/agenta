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

/** The wallet warning above the composer, hidden while another composer strip shows. */
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
    const wallet = useWalletSummary(projectId, {poll: false})
    const alert = useMemo(() => creditAlert(wallet.data), [wallet.data])
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
    const visible = !hidden && alert.kind !== "none" && dismissed[projectId] !== alert.kind

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
                    <CreditAlertNotice
                        alert={current}
                        funding={funding}
                        canBuy={canBuy}
                        onAction={(action) => run[action]()}
                        onDismiss={() => setDismissed({...dismissed, [projectId]: current.kind})}
                    />
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
