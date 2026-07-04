import type {ReactNode} from "react"

import {showConfirmDialog, type ConfirmRequest} from "@agenta/ui/components/modal"

import {globalErrorHandler} from "@/oss/lib/helpers/errorHandler"

export interface AlertPopupProps {
    title: ReactNode
    message: ReactNode
    okText?: ReactNode
    cancelText?: ReactNode | null
    onOk?: () => void | boolean | Promise<void | boolean>
    onCancel?: () => void | Promise<void>
    cancellable?: boolean
    type?: "confirm" | "info" | "success" | "error" | "warning"
    okType?: "primary" | "danger" | "default"
    okButtonProps?: {danger?: boolean; type?: string}
    centered?: boolean
    thirdButtonText?: ReactNode
    onThirdButton?: () => void | Promise<void | boolean>
}

function handleCallback(callback: (() => unknown) | undefined) {
    if (!callback) return undefined
    return async () => {
        try {
            await callback()
        } catch (error) {
            globalErrorHandler(error)
        }
    }
}

export default function AlertPopup({
    title,
    message,
    okText = "Yes",
    cancelText = "Cancel",
    onOk,
    onCancel,
    okType,
    okButtonProps,
    centered,
    thirdButtonText,
    onThirdButton,
}: AlertPopupProps) {
    const request: ConfirmRequest = {
        title,
        message,
        okText,
        cancelText,
        danger: okType === "danger" || okButtonProps?.danger,
        centered,
        thirdButtonText,
        onOk: handleCallback(onOk),
        onCancel: handleCallback(onCancel),
        onThirdButton: handleCallback(onThirdButton),
    }

    return showConfirmDialog(request)
}
