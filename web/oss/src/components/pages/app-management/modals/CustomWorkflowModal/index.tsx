import dynamic from "next/dynamic"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"

import {CustomWorkflowModalProps} from "./types"

const CustomWorkflowModalContent = dynamic(
    () => import("./components/CustomWorkflowModalContent").then((mod) => mod.default),
    {ssr: false},
)

const CustomWorkflowModal = ({
    open,
    onCancel,
    appId,
    onSuccess,
    onCreateApp,
    ...rest
}: CustomWorkflowModalProps) => {
    return (
        <EnhancedModal
            title={null}
            width={480}
            closeIcon={null}
            footer={null}
            open={open}
            onCancel={onCancel}
            {...rest}
        >
            <CustomWorkflowModalContent
                appId={appId}
                onCancel={onCancel}
                onSuccess={onSuccess}
                onCreateApp={onCreateApp}
            />
        </EnhancedModal>
    )
}

export default CustomWorkflowModal
