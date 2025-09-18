import dynamic from "next/dynamic"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"

import {CustomWorkflowModalProps} from "./types"

const CustomWorkflowModalContent = dynamic(
    () => import("./components/CustomWorkflowModalContent").then((mod) => mod.default),
    {ssr: false},
)

const CustomWorkflowModal = (props: CustomWorkflowModalProps) => {
    return (
        <EnhancedModal title={null} width={480} closeIcon={null} footer={null} {...props}>
            <CustomWorkflowModalContent {...props} />
        </EnhancedModal>
    )
}

export default CustomWorkflowModal
