import {useState, useMemo, useCallback, type ReactNode, type MouseEvent} from "react"

import {Trash} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import type {ButtonProps} from "antd"
import dynamic from "next/dynamic"

import type {DeleteEvaluationModalDeletionConfig} from "./types"

const DeleteEvaluationModal = dynamic(
    () => import("@/oss/components/DeleteEvaluationModal/DeleteEvaluationModal"),
    {ssr: false},
)

interface DeleteEvaluationModalButtonProps {
    evaluationType: string
    isMultiple?: boolean
    deletionConfig?: DeleteEvaluationModalDeletionConfig
    disabled?: boolean
    disabledTooltip?: ReactNode
    enabledTooltip?: ReactNode
    buttonProps?: ButtonProps
    children?: ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
}

const DeleteEvaluationModalButton = ({
    evaluationType,
    isMultiple = false,
    deletionConfig,
    disabled = false,
    disabledTooltip,
    enabledTooltip,
    buttonProps,
    children = "Delete",
    open,
    onOpenChange,
}: DeleteEvaluationModalButtonProps) => {
    const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
    const isControlled = typeof open === "boolean"
    const actualOpen = isControlled ? (open as boolean) : uncontrolledOpen

    const setOpen = useCallback(
        (value: boolean) => {
            if (isControlled) {
                onOpenChange?.(value)
            } else {
                setUncontrolledOpen(value)
            }
        },
        [isControlled, onOpenChange],
    )

    const mergedDeletionConfig = useMemo(() => {
        if (!deletionConfig) return undefined
        return {
            ...deletionConfig,
            onSuccess: async () => {
                if (deletionConfig.onSuccess) {
                    await deletionConfig.onSuccess()
                }
                setOpen(false)
            },
            onError: (error: unknown) => {
                deletionConfig.onError?.(error)
                setOpen(false)
            },
        }
    }, [deletionConfig, setOpen])

    const handleClick = useCallback(() => {
        if (disabled) return
        setOpen(true)
    }, [disabled, setOpen])

    const tooltipTitle = disabled ? disabledTooltip : enabledTooltip

    const mergedButtonProps: ButtonProps = {
        danger: buttonProps?.danger ?? true,
        ...(buttonProps ?? {}),
        icon: buttonProps?.icon ?? <Trash size={16} />,
        disabled: disabled || !deletionConfig || buttonProps?.disabled,
        onClick: (event: MouseEvent<HTMLElement>) => {
            buttonProps?.onClick?.(event)
            handleClick()
        },
    }

    const content = <Button {...mergedButtonProps}>{children}</Button>

    return (
        <>
            {tooltipTitle ? (
                <Tooltip title={tooltipTitle}>
                    <span>{content}</span>
                </Tooltip>
            ) : (
                content
            )}

            {mergedDeletionConfig ? (
                <DeleteEvaluationModal
                    open={actualOpen}
                    onCancel={() => setOpen(false)}
                    evaluationType={evaluationType}
                    isMultiple={isMultiple}
                    deletionConfig={mergedDeletionConfig}
                />
            ) : null}
        </>
    )
}

export default DeleteEvaluationModalButton
