import {ReactNode} from "react"

import {modal, ModalFuncProps} from "@agenta/ui/app-message"
import {HookAPI} from "antd/es/modal/useModal"

import {globalErrorHandler} from "@/oss/lib/helpers/errorHandler"

function handleCb(cb: AlertPopupProps["onOk"]) {
    if (typeof cb !== "function") return cb
    return function (close: () => void) {
        const res = cb(close)
        if (res instanceof Promise) {
            return new Promise((_res) => {
                res.catch(globalErrorHandler).finally(() => _res(undefined))
            })
        }
        return res
    }
}

export type AlertPopupProps = ModalFuncProps & {
    message: ReactNode
    cancellable?: boolean
    type?: keyof HookAPI
}

export default function AlertPopup({
    title,
    message,
    okText = "Yes",
    cancelText = "Cancel",
    onOk,
    onCancel,
    onThirdButton,
    cancellable = true,
    type,
    ...ModalProps
}: AlertPopupProps) {
    const _modal = modal

    return _modal[type || "confirm"]({
        title,
        content: message,
        okText,
        cancelText,
        onOk: handleCb(onOk),
        onCancel: handleCb(onCancel),
        onThirdButton: handleCb(onThirdButton),
        closable: cancellable,
        maskClosable: cancellable,
        okButtonProps: {
            size: "middle",
        },
        cancelButtonProps: {
            type: "text",
            size: "middle",
            style: cancelText === null ? {display: "none"} : undefined,
        },
        icon: null,
        okType: "primary",
        // The renderer top-pins anything that omits this.
        centered: true,
        ...ModalProps,
    })
}
