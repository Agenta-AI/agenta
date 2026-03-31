import {useState, useEffect} from "react"

import dynamic from "next/dynamic"

import {EnhancedModalProps} from "./types"

const Modal = dynamic(() => import("antd").then((mod) => mod.Modal), {ssr: false})

const EnhancedModal = ({children, ...props}: EnhancedModalProps) => {
    const [shouldRender, setShouldRender] = useState(false)
    const {open: isVisible, styles: customStyles} = props

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

    // Handle customStyles - it can be an object or a function
    const resolvedCustomStyles =
        typeof customStyles === "function" ? customStyles({props}) : customStyles

    // Separate container, body, footer from other custom styles to avoid override conflicts
    const {
        container: customContainer,
        body: customBody,
        footer: customFooter,
        ...otherCustomStyles
    } = resolvedCustomStyles || {}

    return (
        <Modal
            open={isVisible}
            afterClose={handleAfterClose}
            centered
            destroyOnHidden
            {...props}
            style={{borderRadius: 16, ...props.style}}
            styles={{
                container: {
                    display: "flex",
                    flexDirection: "column",
                    // Only apply maxHeight if not explicitly overridden by customContainer
                    ...(customContainer?.maxHeight === undefined ? {maxHeight: "90vh"} : {}),
                    ...customContainer,
                },
                body: {
                    overflowY: "auto",
                    flex: 1,
                    minHeight: 0,
                    ...customBody,
                },
                footer: {
                    flexShrink: 0,
                    ...customFooter,
                },
                ...otherCustomStyles,
            }}
        >
            {children}
        </Modal>
    )
}

export default EnhancedModal
