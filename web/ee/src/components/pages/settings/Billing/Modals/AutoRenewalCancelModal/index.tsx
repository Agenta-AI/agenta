/**
 * The cancel-auto-renewal dialog. The questionnaire is `@agenta/settings-ui`'s; confirming
 * the cancellation is this host's call.
 */

import {useCallback, useState} from "react"

import {CancelSubscriptionReasons, CANCEL_REASON_OTHER} from "@agenta/settings-ui"
import {message} from "@agenta/ui/app-message"
import {EnhancedModal, type EnhancedModalProps} from "@agenta/ui/components/modal"

import {cancelSubscription, useSubscriptionData, useUsageData} from "@/oss/services/billing"

const AutoRenewalCancelModal = ({...props}: EnhancedModalProps) => {
    const [selectOption, setSelectOption] = useState("")
    const [inputOption, setInputOption] = useState("")
    const [isLoading, setIsLoading] = useState(false)

    const {mutateSubscription} = useSubscriptionData()
    const {mutateUsage} = useUsageData()

    const onConfirmCancel = useCallback(async () => {
        // TODO: add posthog here to send the select form option data
        try {
            setIsLoading(true)
            const data = await cancelSubscription()

            if (data.data.status === "success") {
                message.success("Your subscription has been successfully canceled.")
                setTimeout(() => {
                    mutateUsage()
                    mutateSubscription()
                    props.onCancel?.({} as any)
                }, 500)
            } else {
                message.error(
                    "We were unable to cancel your subscription. Please try again later or contact support if the issue persists.",
                )
            }
        } catch (error) {
            message.error(
                "An error occurred while processing your request. Please try again later or contact support if the issue persists.",
            )
        } finally {
            setIsLoading(false)
        }
    }, [mutateSubscription, mutateUsage, props.onCancel])

    return (
        <EnhancedModal
            title="We’re curious why you’re cancelling auto-renewal?"
            okText="Confirm"
            closable={false}
            confirmLoading={isLoading}
            onOk={onConfirmCancel}
            okButtonProps={{
                disabled: !selectOption || (selectOption === CANCEL_REASON_OTHER && !inputOption),
            }}
            afterClose={() => setSelectOption("")}
            {...props}
        >
            <CancelSubscriptionReasons
                value={selectOption}
                onChange={setSelectOption}
                otherReason={inputOption}
                onOtherReasonChange={setInputOption}
            />
        </EnhancedModal>
    )
}

export default AutoRenewalCancelModal
