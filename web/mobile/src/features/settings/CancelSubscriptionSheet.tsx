import {useState} from "react"

import {
    cancelBillingSubscription,
    CancelSubscriptionReasons,
    CANCEL_REASON_OTHER,
} from "@agenta/settings-ui"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
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
        <Dialog open={open} onOpenChange={(next) => (next ? undefined : onOpenChange(false))}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Cancel auto-renewal</DialogTitle>
                    <DialogDescription>
                        Your plan stays active until the end of the current period.
                    </DialogDescription>
                </DialogHeader>
                <div>
                    <CancelSubscriptionReasons
                        value={reason}
                        onChange={setReason}
                        otherReason={otherReason}
                        onOtherReasonChange={setOtherReason}
                    />
                    {error ? <p className="m-0 pt-2 text-sm text-colorError">{error}</p> : null}
                </div>
                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={cancelling}
                    >
                        Keep my plan
                    </Button>
                    <Button
                        variant="destructive"
                        disabled={!canConfirm || cancelling}
                        onClick={() => void confirm()}
                    >
                        {cancelling ? "Cancelling…" : "Confirm"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
