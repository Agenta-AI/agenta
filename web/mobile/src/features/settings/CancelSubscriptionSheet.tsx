import {useState} from "react"

import {useT} from "@agenta/i18n"
import billingCancelSubscriptionSheetCatalog from "@agenta/i18n/catalogs/billing.cancelSubscriptionSheet"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {
    cancelBillingSubscription,
    CancelSubscriptionReasons,
    CANCEL_REASON_OTHER,
} from "@agenta/settings-ui"
import {
    Alert,
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
} from "@agenta/ui/ui"

interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
    projectId: string
    onChanged: () => void
}

/** Ends auto-renewal, after asking why. */
export const CancelSubscriptionSheet = ({open, onOpenChange, projectId, onChanged}: Props) => {
    const t = useT(billingCancelSubscriptionSheetCatalog, commonCatalog)
    const [reason, setReason] = useState("")
    const [otherReason, setOtherReason] = useState("")
    const [cancelling, setCancelling] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const canConfirm = Boolean(reason) && (reason !== CANCEL_REASON_OTHER || Boolean(otherReason))

    const confirm = async () => {
        setError(null)
        setCancelling(true)
        try {
            await cancelBillingSubscription(projectId)
            onChanged()
            onOpenChange(false)
            setReason("")
            setOtherReason("")
        } catch {
            setError(t("billing.cancelSubscriptionSheet.cancelError"))
        } finally {
            setCancelling(false)
        }
    }

    return (
        <AlertDialog
            open={open}
            onOpenChange={(next) => (next || cancelling ? undefined : onOpenChange(false))}
        >
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {t("billing.cancelSubscriptionSheet.title")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {t("billing.cancelSubscriptionSheet.description")}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {error ? <Alert type="error" showIcon message={error} /> : null}
                <div>
                    <CancelSubscriptionReasons
                        value={reason}
                        onChange={setReason}
                        otherReason={otherReason}
                        onOtherReasonChange={setOtherReason}
                    />
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                        <Button
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={cancelling}
                        >
                            {t("billing.cancelSubscriptionSheet.keepPlan")}
                        </Button>
                    </AlertDialogCancel>
                    {/* Stays open for the error; `confirm` closes it on success. */}
                    <AlertDialogAction asChild>
                        <Button
                            variant="destructive"
                            disabled={!canConfirm || cancelling}
                            onClick={(event) => {
                                event.preventDefault()
                                void confirm()
                            }}
                        >
                            {cancelling
                                ? t("billing.cancelSubscriptionSheet.cancelling")
                                : t("common.confirm")}
                        </Button>
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
