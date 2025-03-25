import {useState, useEffect} from "react"

import dynamic from "next/dynamic"

import {EnhancedDrawerProps} from "./types"

const Drawer = dynamic(() => import("antd").then((mod) => mod.Drawer), {ssr: false})

const EnhancedDrawer = ({children, ...props}: EnhancedDrawerProps) => {
    const [shouldRender, setShouldRender] = useState(false)
    const {open: isVisible} = props

    useEffect(() => {
        if (isVisible) {
            setShouldRender(true)
        }
    }, [isVisible])

    const handleAfterClose = (open: boolean) => {
        props.afterOpenChange?.(open)
        if (!open) {
            setShouldRender(false)
        }
    }

    if (!shouldRender) return null

    return (
        <Drawer open={isVisible} afterOpenChange={handleAfterClose} destroyOnClose {...props}>
            {children}
        </Drawer>
    )
}

export default EnhancedDrawer
