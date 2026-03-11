import {message} from "antd"

import {WebhookDeliveryResponse} from "@/oss/services/automations/types"

/**
 * Handles the response from a webhook test and shows appropriate success/error messages.
 */
export const handleTestResult = (response: WebhookDeliveryResponse) => {
    const delivery = response?.delivery

    if (delivery?.status?.code === "success" || delivery?.status?.type === "success") {
        message.success(
            `Connection successful! Status: ${delivery.data?.response?.status_code || 200}`,
            10,
        )
    } else {
        message.error(`Connection failed. ${delivery?.status?.message || "Unknown error"}`, 10)
    }
}
