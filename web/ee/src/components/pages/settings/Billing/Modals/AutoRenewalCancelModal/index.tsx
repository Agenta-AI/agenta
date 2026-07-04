import {useCallback, useState} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/primitive-ui/components/dialog"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {toast} from "@agenta/primitive-ui/lib/toast"
import dynamic from "next/dynamic"

import {cancelSubscription, useSubscriptionData, useUsageData} from "@/oss/services/billing"

import {AutoRenewalCancelModalProps} from "./assets/types"

const AutoRenewalCancelModalContent = dynamic(
    () => import("./assets/AutoRenewalCancelModalContent"),
    {ssr: false},
)

const AutoRenewalCancelModal = ({open, onClose}: AutoRenewalCancelModalProps) => {
    const [selectOption, setSelectOption] = useState("")
    const [inputOption, setInputOption] = useState("")
    const [isLoading, setIsLoading] = useState(false)

    const {mutateSubscription} = useSubscriptionData()
    const {mutateUsage} = useUsageData()

    const handleClose = useCallback(() => {
        onClose()
        setSelectOption("")
    }, [onClose])

    const onConfirmCancel = useCallback(async () => {
        // TODO: add posthog here to send the select form option data
        try {
            setIsLoading(true)
            const data = await cancelSubscription()

            if (data.data.status === "success") {
                toast.success("Your subscription has been successfully canceled.")
                setTimeout(() => {
                    mutateUsage()
                    mutateSubscription()
                    handleClose()
                }, 500)
            } else {
                toast.error(
                    "We were unable to cancel your subscription. Please try again later or contact support if the issue persists.",
                )
            }
        } catch (error) {
            toast.error(
                "An error occurred while processing your request. Please try again later or contact support if the issue persists.",
            )
        } finally {
            setIsLoading(false)
        }
    }, [mutateSubscription, mutateUsage, cancelSubscription, handleClose])

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) handleClose()
            }}
        >
            <DialogContent showCloseButton={false}>
                <DialogHeader>
                    <DialogTitle>We’re curious why you’re cancelling auto-renewal?</DialogTitle>
                </DialogHeader>
                <AutoRenewalCancelModalContent
                    value={selectOption}
                    onChange={setSelectOption}
                    inputValue={inputOption}
                    onChangeInput={(e) => setInputOption(e.target.value)}
                />
                <DialogFooter>
                    <Button variant="outline" onClick={handleClose}>
                        Cancel
                    </Button>
                    <Button
                        disabled={
                            !selectOption ||
                            (selectOption == "something-else" && !inputOption) ||
                            isLoading
                        }
                        onClick={onConfirmCancel}
                    >
                        {isLoading ? <Spinner /> : null}
                        Confirm
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default AutoRenewalCancelModal
