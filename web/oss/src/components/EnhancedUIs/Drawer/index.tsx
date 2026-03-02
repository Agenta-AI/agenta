import {useState, useEffect, useMemo} from "react"

import {Drawer} from "antd"

import {EnhancedDrawerProps} from "./types"

const EnhancedDrawer = ({
    children,
    closeOnLayoutClick = true,
    width,
    styles,
    ...props
}: EnhancedDrawerProps) => {
    const [shouldRender, setShouldRender] = useState(false)
    const {open: isVisible, onClose, mask} = props

    const drawerStyles = useMemo(() => {
        if (!width) return styles
        return {
            ...styles,
            wrapper: {
                ...styles?.wrapper,
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
                onClose?.({} as any)
            }
        }

        document.addEventListener("click", handleClickOutside)
        return () => {
            document.removeEventListener("click", handleClickOutside)
        }
    }, [shouldRender, closeOnLayoutClick, onClose])

    const handleAfterClose = (open: boolean) => {
        props.afterOpenChange?.(open)
        if (!open) {
            setShouldRender(false)
        }
    }

    if (!shouldRender) return null

    return (
        <Drawer
            open={isVisible}
            afterOpenChange={handleAfterClose}
            destroyOnHidden
            {...props}
            styles={drawerStyles}
            mask={maskProps}
        >
            {children}
        </Drawer>
    )
}

export default EnhancedDrawer
