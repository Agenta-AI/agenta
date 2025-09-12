import {useState, useEffect} from "react"

import {Drawer} from "antd"

import {EnhancedDrawerProps} from "./types"

const EnhancedDrawer = ({children, ...props}: EnhancedDrawerProps) => {
    const [shouldRender, setShouldRender] = useState(false)
    const {open: isVisible} = props

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
            } else if ((event.target as HTMLElement).closest(".ant-layout")) {
                props.onClose?.({} as any)
            }
        }

        document.addEventListener("click", handleClickOutside)
        return () => {
            document.removeEventListener("click", handleClickOutside)
        }
    }, [shouldRender])

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
