import {message} from "antd"

import {WebhookDeliveryResponse} from "@/oss/services/automations/types"

/**
 * Handles the response from a webhook test and shows appropriate success/error messages.
 */
export const handleTestResult = (response: WebhookDeliveryResponse) => {
    const delivery = response?.delivery
    const isSuccess = delivery?.status?.message === "success"
    const statusCode = delivery?.data?.response?.status_code ?? delivery?.status?.code
    const errorDetail = delivery?.data?.error || delivery?.status?.message || "Unknown error"

    if (isSuccess) {
        message.success(`Connection successful! Status: ${statusCode || 200}`, 10)
    } else {
        message.error(`Connection failed. ${errorDetail}`, 10)
    }
}
