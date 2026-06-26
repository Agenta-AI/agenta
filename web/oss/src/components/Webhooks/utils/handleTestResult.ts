import {message} from "antd"

import {WebhookDeliveryResponse} from "@/oss/services/webhooks/types"

export const WEBHOOK_TEST_SUCCESS_MESSAGE = "Webhook test successful."
export const WEBHOOK_TEST_FAILURE_MESSAGE =
    "Webhook test failed. Please edit settings and try again."

/**
 * Handles the response from a webhook test and shows appropriate success/error messages.
 */
export const handleTestResult = (response: WebhookDeliveryResponse) => {
    const delivery = response?.delivery
    const isSuccess = delivery?.status?.message === "success"
    const statusCode = delivery?.status?.code
    const failureSuffix = statusCode ? ` [${statusCode}]` : ""

    if (isSuccess) {
        message.success(WEBHOOK_TEST_SUCCESS_MESSAGE, 10)
    } else {
        message.error(`${WEBHOOK_TEST_FAILURE_MESSAGE}${failureSuffix}`, 10)
    }
}
