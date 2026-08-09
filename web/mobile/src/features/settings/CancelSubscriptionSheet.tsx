import {useState} from "react"

import {
    cancelBillingSubscription,
    CancelSubscriptionReasons,
    CANCEL_REASON_OTHER,
} from "@agenta/settings-ui"

import {Button} from "@/components/ui/button"
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"

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
        <Sheet open={open} onOpenChange={(next) => (next ? undefined : onOpenChange(false))}>
            <SheetContent side="responsive">
                <SheetHeader>
                    <SheetTitle>Cancel auto-renewal</SheetTitle>
                    <SheetDescription>
                        Your plan stays active until the end of the current period.
                    </SheetDescription>
                </SheetHeader>
                <div className="px-4">
                    <CancelSubscriptionReasons
                        value={reason}
                        onChange={setReason}
                        otherReason={otherReason}
                        onOtherReasonChange={setOtherReason}
                    />
                    {error ? <p className="m-0 pt-2 text-sm text-colorError">{error}</p> : null}
                </div>
                <SheetFooter>
                    <Button
                        variant="destructive"
                        disabled={!canConfirm || cancelling}
                        onClick={() => void confirm()}
                    >
                        {cancelling ? "Cancelling…" : "Confirm"}
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={cancelling}
                    >
                        Keep my plan
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}
