import {useCallback, useEffect, useState, type CSSProperties, type ReactNode} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/primitive-ui/components/dialog"
import {cn} from "@agenta/primitive-ui/lib/utils"

export interface EnhancedModalStyles {
    container?: CSSProperties
    body?: CSSProperties
    footer?: CSSProperties
    header?: CSSProperties
    mask?: CSSProperties
    content?: CSSProperties
    wrapper?: CSSProperties
}

export interface EnhancedModalClassNames {
    container?: string
    body?: string
    footer?: string
    header?: string
    mask?: string
    content?: string
    wrapper?: string
}

export interface EnhancedModalButtonProps extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "type"
> {
    type?: "primary" | "default" | "dashed" | "link" | "text"
    danger?: boolean
    loading?: boolean | {delay?: number}
    icon?: ReactNode
}

export interface EnhancedModalProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
    children?: ReactNode
    open?: boolean
    title?: ReactNode
    footer?: ReactNode
    width?: number | string
    height?: number | string
    centered?: boolean
    closable?: boolean
    closeIcon?: ReactNode
    mask?: boolean | {blur?: boolean}
    maskClosable?: boolean
    destroyOnClose?: boolean
    destroyOnHidden?: boolean
    afterClose?: () => void
    afterOpenChange?: (open: boolean) => void
    onCancel?: (event: React.MouseEvent<HTMLButtonElement>) => void
    onOk?: (event: React.MouseEvent<HTMLButtonElement>) => void
    okText?: ReactNode
    cancelText?: ReactNode
    okType?: EnhancedModalButtonProps["type"] | "danger"
    confirmLoading?: boolean
    okButtonProps?: EnhancedModalButtonProps
    cancelButtonProps?: EnhancedModalButtonProps
    rootClassName?: string
    classNames?: EnhancedModalClassNames
    styles?: EnhancedModalStyles | ((context: {props: EnhancedModalProps}) => EnhancedModalStyles)
    zIndex?: number
    maxHeight?: string
    lazyRender?: boolean
}

const buttonVariant = (
    type: EnhancedModalButtonProps["type"] | "danger" | undefined,
    danger?: boolean,
) => {
    if (danger || type === "danger") return "destructive" as const
    if (type === "link") return "link" as const
    if (type === "text") return "ghost" as const
    if (type === "default" || type === "dashed") return "outline" as const
    return "default" as const
}

export function EnhancedModal({
    children,
    open = false,
    title,
    footer,
    width,
    height,
    centered = true,
    closable = true,
    closeIcon,
    mask = true,
    maskClosable = true,
    destroyOnClose: _destroyOnClose,
    destroyOnHidden: _destroyOnHidden,
    afterClose,
    afterOpenChange,
    onCancel,
    onOk,
    okText = "OK",
    cancelText = "Cancel",
    okType = "primary",
    confirmLoading = false,
    okButtonProps,
    cancelButtonProps,
    rootClassName,
    className,
    classNames,
    styles: customStyles,
    style,
    zIndex,
    maxHeight = "90vh",
    lazyRender = true,
    ...contentProps
}: EnhancedModalProps) {
    const [shouldRender, setShouldRender] = useState(!lazyRender || open)

    useEffect(() => {
        if (open) setShouldRender(true)
    }, [open])

    const handleAfterOpenChange = useCallback(
        (isOpen: boolean) => {
            afterOpenChange?.(isOpen)
            if (isOpen) return
            afterClose?.()
            if (lazyRender) setShouldRender(false)
        },
        [afterClose, afterOpenChange, lazyRender],
    )

    if (!shouldRender) return null

    const modalProps: EnhancedModalProps = {
        children,
        open,
        title,
        footer,
        width,
        height,
        centered,
        closable,
        closeIcon,
        mask,
        maskClosable,
        afterClose,
        afterOpenChange,
        onCancel,
        onOk,
        okText,
        cancelText,
        okType,
        confirmLoading,
        okButtonProps,
        cancelButtonProps,
        rootClassName,
        className,
        classNames,
        styles: customStyles,
        style,
        zIndex,
        maxHeight,
        lazyRender,
        ...contentProps,
    }
    const styles =
        typeof customStyles === "function" ? customStyles({props: modalProps}) : customStyles
    const resolvedWidth = typeof width === "number" ? `${width}px` : width
    const contentStyle: CSSProperties = {
        width: resolvedWidth,
        height: typeof height === "number" ? `${height}px` : height,
        maxWidth: resolvedWidth ? "calc(100vw - 2rem)" : undefined,
        maxHeight,
        zIndex,
        ...style,
        ...styles?.wrapper,
        ...styles?.container,
        ...styles?.content,
    }
    const {
        type: cancelType,
        danger: cancelDanger,
        loading: cancelLoading,
        icon: cancelIcon,
        onClick: cancelOnClick,
        ...cancelHtmlProps
    } = cancelButtonProps ?? {}
    const {
        type: okButtonType,
        danger: okDanger,
        loading: okLoading,
        icon: okIcon,
        onClick: okOnClick,
        ...okHtmlProps
    } = okButtonProps ?? {}

    const cancelButton = (
        <Button
            type="button"
            variant={buttonVariant(cancelType, cancelDanger)}
            {...cancelHtmlProps}
            disabled={cancelHtmlProps.disabled || Boolean(cancelLoading)}
            onClick={(event) => {
                cancelOnClick?.(event)
                if (!event.defaultPrevented) onCancel?.(event)
            }}
        >
            {cancelIcon}
            {cancelText}
        </Button>
    )
    const okButton = (
        <Button
            type="button"
            variant={buttonVariant(okButtonType ?? okType, okDanger)}
            {...okHtmlProps}
            disabled={okHtmlProps.disabled || confirmLoading || Boolean(okLoading)}
            aria-busy={confirmLoading || Boolean(okLoading)}
            onClick={(event) => {
                okOnClick?.(event)
                if (!event.defaultPrevented) onOk?.(event)
            }}
        >
            {okIcon}
            {okText}
        </Button>
    )

    return (
        <Dialog
            open={open}
            modal
            disablePointerDismissal={!maskClosable}
            onOpenChange={(isOpen) => {
                if (!isOpen) onCancel?.({} as React.MouseEvent<HTMLButtonElement>)
            }}
            onOpenChangeComplete={handleAfterOpenChange}
        >
            <DialogContent
                {...contentProps}
                showOverlay={mask !== false}
                showCloseButton={closable && closeIcon !== null}
                closeIcon={closeIcon}
                overlayClassName={classNames?.mask}
                overlayStyle={{zIndex, ...styles?.mask}}
                className={cn(
                    "flex max-w-none flex-col gap-0 overflow-hidden p-0",
                    !centered && "top-6 translate-y-0",
                    rootClassName,
                    classNames?.wrapper,
                    classNames?.container,
                    classNames?.content,
                    className,
                )}
                style={contentStyle}
            >
                {title !== null && title !== undefined && (
                    <DialogHeader
                        className={cn("shrink-0 border-b px-4 py-3", classNames?.header)}
                        style={styles?.header}
                    >
                        <DialogTitle>{title}</DialogTitle>
                    </DialogHeader>
                )}
                <div
                    className={cn("min-h-0 flex-1 overflow-y-auto p-4", classNames?.body)}
                    style={{...styles?.body}}
                >
                    {children}
                </div>
                {footer !== null && (
                    <DialogFooter
                        className={cn("m-0 shrink-0 rounded-none", classNames?.footer)}
                        style={styles?.footer}
                    >
                        {footer === undefined ? (
                            <>
                                {cancelButton}
                                {okButton}
                            </>
                        ) : (
                            footer
                        )}
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    )
}

export default EnhancedModal
