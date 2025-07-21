import {useState, useEffect} from "react"

import dynamic from "next/dynamic"

import {EnhancedModalProps} from "./types"

const Modal = dynamic(() => import("antd").then((mod) => mod.Modal), {ssr: false})

const EnhancedModal = ({children, ...props}: EnhancedModalProps) => {
    const [shouldRender, setShouldRender] = useState(false)
    const {open: isVisible} = props

    useEffect(() => {
        if (isVisible) {
            setShouldRender(true)
        }
    }, [isVisible])

    const handleAfterClose = () => {
        props.afterClose?.()
        setShouldRender(false)
    }

    if (!shouldRender) return null

    return (
        <Modal
            open={isVisible}
            afterClose={handleAfterClose}
            style={{maxHeight: "95dvh", overflowY: "auto", borderRadius: 16, ...props.style}}
            centered
            destroyOnHidden
            {...props}
        >
            {children}
        </Modal>
    )
}

export default EnhancedModal
