import {useState, useEffect} from "react"

import {Drawer} from "antd"

import {EnhancedDrawerProps} from "./types"

const EnhancedDrawer = ({children, closeOnLayoutClick = true, ...props}: EnhancedDrawerProps) => {
    const [shouldRender, setShouldRender] = useState(false)
    const {open: isVisible, onClose} = props

    useEffect(() => {
        if (isVisible) {
            setShouldRender(true)
        }
    }, [isVisible])

    // Effect to close drawer when outside click
    useEffect(() => {
        if (!shouldRender) return

        function handleClickOutside(event: MouseEvent) {
            const target = event.target as HTMLElement | null
            if (!target) return

            if (
                target.closest(".variant-table-row") ||
                target.closest(".scenario-row") ||
                target.closest("[data-focus-drawer-trigger]")
            ) {
                return
            } else if (closeOnLayoutClick && target.closest(".ant-layout")) {
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
        <Drawer open={isVisible} afterOpenChange={handleAfterClose} destroyOnHidden {...props}>
            {children}
        </Drawer>
    )
}

export default EnhancedDrawer
