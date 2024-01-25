import AlertPopup from "@/components/AlertPopup/AlertPopup"
import {message} from "antd"

export const getErrorMessage = (error: any, fallback = "An unknown error occurred!") => {
    let message = fallback
    try {
        error?.preventDefault && error.preventDefault()
        if (typeof error === "string") message = error
        else if (error.message) message = error.message
        else if (error && typeof error === "object")
            message = getErrorMessage(Object.values(error)[0])
        else message = JSON.stringify(error)
    } catch {}

    return message
}

export const globalErrorHandler = (error: any) => {
    if (error.response?.status === 403) {
        AlertPopup({
            title: "Permission Denied",
            message:
                "You don't have permission to perform this action. Please contact your organization admin.",
            cancelText: null,
            okText: "Ok",
        })
        return
    }

    const errorMsg = getErrorMessage(error)
    console.error(errorMsg, error)
    message.error(errorMsg)
}
