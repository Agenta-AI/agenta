import {ReactNode} from "react"

import {Button, ModalFuncProps} from "antd"
import {HookAPI} from "antd/es/modal/useModal"

import {globalErrorHandler} from "@/oss/lib/helpers/errorHandler"

import {modal} from "../AppMessageContext"

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
    type?: keyof HookAPI
    /** Third button text (shown between cancel and ok) */
    thirdButtonText?: string
    /** Third button click handler */
    onThirdButton?: () => void | Promise<void | boolean>
}

export default function AlertPopup({
    title,
    message,
    okText = "Yes",
    cancelText = "Cancel",
    onOk,
    onCancel,
    cancellable = true,
    type,
    thirdButtonText,
    onThirdButton,
    ...ModalProps
}: AlertPopupProps) {
    const _modal = modal

    // Store modal instance reference for closing from custom button
    let modalInstance: ReturnType<typeof _modal.confirm> | null = null

    const handleThirdButton = async () => {
        if (onThirdButton) {
            await handleCb(onThirdButton)?.()
        }
        modalInstance?.destroy()
    }

    // Custom footer with 3 buttons when thirdButtonText is provided
    const customFooter = thirdButtonText
        ? (_: ReactNode, {OkBtn, CancelBtn}: {OkBtn: React.FC; CancelBtn: React.FC}) => (
              <div className="flex items-center justify-end gap-2">
                  <CancelBtn />
                  <Button size="middle" onClick={handleThirdButton}>
                      {thirdButtonText}
                  </Button>
                  <OkBtn />
              </div>
          )
        : undefined

    modalInstance = _modal[type || "confirm"]({
        title,
        content: message,
        okText,
        cancelText,
        onOk: handleCb(onOk),
        onCancel: handleCb(onCancel),
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
        footer: customFooter,
        ...ModalProps,
    })

    return modalInstance
}
