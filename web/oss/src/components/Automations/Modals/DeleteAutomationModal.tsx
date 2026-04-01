import {useState} from "react"

import {EnhancedModal} from "@agenta/ui"
import {message} from "antd"
import {useAtom, useSetAtom} from "jotai"

import {deleteAutomationAtom} from "@/oss/state/automations/atoms"
import {webhookToDeleteAtom} from "@/oss/state/automations/state"

const DeleteAutomationModal = () => {
    const deleteWebhookSubscription = useSetAtom(deleteAutomationAtom)
    const [webhookToDelete, setWebhookToDelete] = useAtom(webhookToDeleteAtom)
    const [isDeleteModalLoading, setIsDeleteModalLoading] = useState(false)

    const handleDeleteConfirm = async () => {
        if (!webhookToDelete) return
        setIsDeleteModalLoading(true)
        try {
            await deleteWebhookSubscription(webhookToDelete.id)
            message.success("Automation deleted successfully")
            setWebhookToDelete(null)
        } catch (error) {
            message.error("Failed to delete automation")
        } finally {
            setIsDeleteModalLoading(false)
        }
    }

    return (
        <EnhancedModal
            title="Delete Automation"
            open={!!webhookToDelete}
            onOk={handleDeleteConfirm}
            onCancel={() => setWebhookToDelete(null)}
            okText="Delete"
            cancelText="Cancel"
            centered
            confirmLoading={isDeleteModalLoading}
            okButtonProps={{danger: true}}
        >
            <p>Are you sure you want to delete this automation?</p>
        </EnhancedModal>
    )
}

export default DeleteAutomationModal
