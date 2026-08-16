import {useState} from "react"

import {cancelBillingSubscription} from "@agenta/settings-ui"

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

/**
 * Ends auto-renewal. No exit questionnaire: `POST /billing/subscription/cancel` takes nothing
 * but the project, so asking why would collect an answer with nowhere to go.
 */
export const CancelSubscriptionSheet = ({open, onOpenChange, projectId, onChanged}: Props) => {
    const [cancelling, setCancelling] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const confirm = async () => {
        setError(null)
        setCancelling(true)
        try {
            await cancelBillingSubscription(projectId)
            onChanged()
            onOpenChange(false)
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
                    <p className="m-0 text-xs text-colorTextSecondary">
                        Your organization moves to the free plan when the period ends.
                    </p>
                    {error ? <p className="m-0 pt-2 text-xs text-colorError">{error}</p> : null}
                </div>
                <SheetFooter>
                    <Button
                        variant="destructive"
                        disabled={cancelling}
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
