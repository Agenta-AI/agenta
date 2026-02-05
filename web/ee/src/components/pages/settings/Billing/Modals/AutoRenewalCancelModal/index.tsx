import {useCallback, useState} from "react"

import {message} from "@agenta/ui/app-message"
import dynamic from "next/dynamic"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {cancelSubscription, useSubscriptionData, useUsageData} from "@/oss/services/billing"

import {AutoRenewalCancelModalProps} from "./assets/types"

const AutoRenewalCancelModalContent = dynamic(
    () => import("./assets/AutoRenewalCancelModalContent"),
    {ssr: false},
)

const AutoRenewalCancelModal = ({...props}: AutoRenewalCancelModalProps) => {
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
    }, [mutateSubscription, mutateUsage, cancelSubscription])

    return (
        <EnhancedModal
            title="We’re curious why you’re cancelling auto-renewal?"
            okText="Confirm"
            closable={false}
            confirmLoading={isLoading}
            onOk={onConfirmCancel}
            okButtonProps={{
                disabled: !selectOption || (selectOption == "something-else" && !inputOption),
            }}
            afterClose={() => setSelectOption("")}
            {...props}
        >
            <AutoRenewalCancelModalContent
                value={selectOption}
                onChange={(e) => setSelectOption(e.target.value)}
                inputValue={inputOption}
                onChangeInput={(e) => setInputOption(e.target.value)}
            />
        </EnhancedModal>
    )
}

export default AutoRenewalCancelModal
