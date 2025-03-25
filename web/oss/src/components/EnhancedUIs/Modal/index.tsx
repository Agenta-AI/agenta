import {useState, useEffect} from "react"

import clsx from "clsx"
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
            // className={clsx(
            //     "flex flex-col",
            //     "[&_.ant-modal-content]:flex [&_.ant-modal-content]:flex-col [&_.ant-modal-content]:max-h-[90vh]",
            //     "[&_.ant-modal-body]:flex-1 [&_.ant-modal-body]:overflow-auto",
            //     "[&_.ant-modal-footer]:shrink-0",
            //     props.className,
            // )}
            // style={{maxHeight: "90vh", maxWidth: "90vw"}}
            centered
            destroyOnClose
            {...props}
        >
            {children}
        </Modal>
    )
}

export default EnhancedModal
