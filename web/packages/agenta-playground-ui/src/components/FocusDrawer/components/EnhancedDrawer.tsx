import {useEffect, useMemo, useState} from "react"

import {Drawer, type DrawerProps} from "antd"

export interface EnhancedDrawerProps extends DrawerProps {
    children: React.ReactNode
    closeOnLayoutClick?: boolean
}

const EnhancedDrawer = ({
    children,
    closeOnLayoutClick = true,
    width,
    styles,
    afterOpenChange: externalAfterOpenChange,
    ...props
}: EnhancedDrawerProps) => {
    const {open: isVisible, onClose, mask} = props
    const [shouldRender, setShouldRender] = useState(!!isVisible)

    const drawerStyles = useMemo(() => {
        if (!width) return styles
        const s = styles as Record<string, unknown> | undefined
        return {
            ...s,
            wrapper: {
                ...(s?.wrapper as React.CSSProperties | undefined),
                width,
            },
        }
    }, [width, styles])

    const maskProps = useMemo(() => {
        if (mask === false) return false
        const maskObj = typeof mask === "object" ? mask : {}
        return {blur: false, ...maskObj}
    }, [mask])

    useEffect(() => {
        if (isVisible) {
            setShouldRender(true)
        }
    }, [isVisible])

    // Effect to close drawer when outside click
    useEffect(() => {
        if (!shouldRender) return

        function handleClickOutside(event: MouseEvent) {
            if ((event.target as HTMLElement).closest(".variant-table-row")) {
                return
            } else if (closeOnLayoutClick && (event.target as HTMLElement).closest(".ant-layout")) {
                onClose?.({} as React.MouseEvent)
            }
        }

        document.addEventListener("click", handleClickOutside)
        return () => {
            document.removeEventListener("click", handleClickOutside)
        }
    }, [shouldRender, closeOnLayoutClick, onClose])

    const handleAfterOpenChange = (open: boolean) => {
        externalAfterOpenChange?.(open)
        if (!open) {
            setShouldRender(false)
        }
    }

    if (!shouldRender) return null

    return (
        <Drawer
            {...props}
            open={isVisible}
            width={width}
            afterOpenChange={handleAfterOpenChange}
            styles={drawerStyles}
            mask={maskProps}
        >
            {children}
        </Drawer>
    )
}

export default EnhancedDrawer
