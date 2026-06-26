import {useState} from "react"

import {EnhancedModal} from "@agenta/ui"
import {message} from "antd"
import {useAtom, useSetAtom} from "jotai"

import {deleteWebhookAtom} from "@/oss/state/webhooks/atoms"
import {webhookToDeleteAtom} from "@/oss/state/webhooks/state"

const DeleteWebhookModal = () => {
    const deleteWebhookSubscription = useSetAtom(deleteWebhookAtom)
    const [webhookToDelete, setWebhookToDelete] = useAtom(webhookToDeleteAtom)
    const [isDeleteModalLoading, setIsDeleteModalLoading] = useState(false)

    const handleDeleteConfirm = async () => {
        if (!webhookToDelete) return
        setIsDeleteModalLoading(true)
        try {
            await deleteWebhookSubscription(webhookToDelete.id)
            message.success("Webhook deleted successfully")
            setWebhookToDelete(null)
        } catch (error) {
            message.error("Failed to delete webhook")
        } finally {
            setIsDeleteModalLoading(false)
        }
    }

    return (
        <EnhancedModal
            title="Delete Webhook"
            open={!!webhookToDelete}
            onOk={handleDeleteConfirm}
            onCancel={() => setWebhookToDelete(null)}
            okText="Delete"
            cancelText="Cancel"
            centered
            confirmLoading={isDeleteModalLoading}
            okButtonProps={{danger: true}}
        >
            <p>Are you sure you want to delete this webhook?</p>
        </EnhancedModal>
    )
}

export default DeleteWebhookModal
