import {message} from "antd"

export const globalErrorHandler = (error: any) => {
    error?.preventDefault && error.preventDefault()

    if (typeof error === "string") error = {message: error}

    error.message = error.message || "An unknown error occurred!"
    console.error(error.message, error)
    message.error(error.message)
}
