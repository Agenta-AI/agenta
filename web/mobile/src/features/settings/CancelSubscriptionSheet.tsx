import {useState} from "react"

import {
    cancelBillingSubscription,
    CancelSubscriptionReasons,
    CANCEL_REASON_OTHER,
} from "@agenta/settings-ui"
import {
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
            setError("We couldn't cancel your subscription. Try again, or contact support.")
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
                    <AlertDialogTitle>Cancel auto-renewal</AlertDialogTitle>
                    <AlertDialogDescription>
                        Your plan stays active until the end of the current period.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div>
                    <CancelSubscriptionReasons
                        value={reason}
                        onChange={setReason}
                        otherReason={otherReason}
                        onOtherReasonChange={setOtherReason}
                    />
                    {error ? <p className="m-0 pt-2 text-sm text-colorError">{error}</p> : null}
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                        <Button
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={cancelling}
                        >
                            Keep my plan
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
                            {cancelling ? "Cancelling…" : "Confirm"}
                        </Button>
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
