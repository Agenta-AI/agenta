import {useCallback, useEffect, useState, type CSSProperties, type ReactNode} from "react"

import {
    Sheet,
    SheetContent,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@agenta/primitive-ui/components/sheet"
import {cn} from "@agenta/primitive-ui/lib/utils"

export interface EnhancedDrawerStyles {
    body?: CSSProperties
    content?: CSSProperties
    footer?: CSSProperties
    header?: CSSProperties
    mask?: CSSProperties
    wrapper?: CSSProperties
}

export interface EnhancedDrawerClassNames {
    body?: string
    content?: string
    footer?: string
    header?: string
    mask?: string
    wrapper?: string
}

export interface EnhancedDrawerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
    children: ReactNode
    open?: boolean
    onClose?: (event: React.MouseEvent | React.KeyboardEvent) => void
    afterOpenChange?: (open: boolean) => void
    title?: ReactNode
    extra?: ReactNode
    footer?: ReactNode
    width?: number | string
    size?: "default" | "large" | number | string
    placement?: "top" | "right" | "bottom" | "left"
    closable?: boolean
    closeIcon?: ReactNode
    mask?: boolean | {blur?: boolean}
    maskClosable?: boolean
    destroyOnClose?: boolean
    destroyOnHidden?: boolean
    rootClassName?: string
    classNames?: EnhancedDrawerClassNames
    styles?: EnhancedDrawerStyles
    closeOnLayoutClick?: boolean
}

const sizeToWidth = (size: EnhancedDrawerProps["size"]) => {
    if (size === "large") return 736
    if (size === "default" || size === undefined) return 378
    return size
}

const EnhancedDrawer = ({
    children,
    open = false,
    onClose,
    afterOpenChange,
    title,
    extra,
    footer,
    width,
    size,
    placement = "right",
    closable = true,
    closeIcon,
    mask = true,
    maskClosable = true,
    destroyOnClose: _destroyOnClose,
    destroyOnHidden: _destroyOnHidden,
    rootClassName,
    className,
    classNames,
    styles,
    style,
    closeOnLayoutClick = true,
    ...contentProps
}: EnhancedDrawerProps) => {
    const [shouldRender, setShouldRender] = useState(open)

    useEffect(() => {
        if (open) setShouldRender(true)
    }, [open])

    useEffect(() => {
        if (!shouldRender || !closeOnLayoutClick) return

        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as HTMLElement
            if (target.closest(".variant-table-row")) return
            if (target.closest(".ant-layout")) {
                onClose?.({} as React.MouseEvent)
            }
        }

        document.addEventListener("click", handleClickOutside)
        return () => document.removeEventListener("click", handleClickOutside)
    }, [shouldRender, closeOnLayoutClick, onClose])

    const handleAfterOpenChange = useCallback(
        (isOpen: boolean) => {
            afterOpenChange?.(isOpen)
            if (!isOpen) setShouldRender(false)
        },
        [afterOpenChange],
    )

    if (!shouldRender) return null

    const resolvedSize = width ?? sizeToWidth(size)
    const horizontal = placement === "left" || placement === "right"
    const dimensionStyle: CSSProperties = horizontal
        ? {width: typeof resolvedSize === "number" ? `${resolvedSize}px` : resolvedSize}
        : {height: typeof resolvedSize === "number" ? `${resolvedSize}px` : resolvedSize}

    return (
        <Sheet
            open={open}
            modal
            disablePointerDismissal={!maskClosable}
            onOpenChange={(isOpen) => {
                if (!isOpen) onClose?.({} as React.MouseEvent)
            }}
            onOpenChangeComplete={handleAfterOpenChange}
        >
            <SheetContent
                {...contentProps}
                side={placement}
                showOverlay={mask !== false}
                showCloseButton={closable && closeIcon !== null}
                closeIcon={closeIcon}
                overlayClassName={classNames?.mask}
                overlayStyle={styles?.mask}
                className={cn(
                    "w-auto max-w-[calc(100vw-1rem)] gap-0",
                    rootClassName,
                    classNames?.wrapper,
                    classNames?.content,
                    className,
                )}
                style={{...dimensionStyle, ...style, ...styles?.wrapper, ...styles?.content}}
            >
                {(title !== null && title !== undefined) || extra ? (
                    <SheetHeader
                        className={cn(
                            "shrink-0 flex-row items-center justify-between border-b",
                            classNames?.header,
                        )}
                        style={styles?.header}
                    >
                        {title !== null && title !== undefined && <SheetTitle>{title}</SheetTitle>}
                        {extra}
                    </SheetHeader>
                ) : null}
                <div
                    className={cn("min-h-0 flex-1 overflow-y-auto p-4", classNames?.body)}
                    style={styles?.body}
                >
                    {children}
                </div>
                {footer !== null && footer !== undefined && (
                    <SheetFooter
                        className={cn("shrink-0 border-t", classNames?.footer)}
                        style={styles?.footer}
                    >
                        {footer}
                    </SheetFooter>
                )}
            </SheetContent>
        </Sheet>
    )
}

export default EnhancedDrawer
