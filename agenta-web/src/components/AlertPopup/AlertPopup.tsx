import React, {ReactNode} from "react"
import {Modal, ModalFuncProps} from "antd"
import {ExclamationCircleOutlined} from "@ant-design/icons"
import {globalErrorHandler} from "@/lib/helpers/errorHandler"
import { HookAPI } from "antd/es/modal/useModal"

function handleCb(cb: AlertPopupProps["onOk"]) {
    if (typeof cb !== "function") return cb
    return function () {
        const res = cb()
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
    modalInstance?: HookAPI
}

export default function AlertPopup({
    title,
    message,
    okText = "Yes",
    cancelText = "Cancel",
    onOk,
    onCancel,
    cancellable = true,
    modalInstance,
    type,
    ...ModalProps
}: AlertPopupProps) {
    const modalIns = modalInstance as any || Modal;
    return modalIns[type || "confirm"]({
        title,
        content: message,
        okText,
        cancelText,
        onOk: handleCb(onOk),
        onCancel: handleCb(onCancel),
        closable: cancellable,
        maskClosable: cancellable,
        cancelButtonProps: {
            style: cancelText === null ? {display: "none"} : undefined,
        },
        icon: <ExclamationCircleOutlined />,
        okType: "default",
        ...ModalProps,
    })
}
