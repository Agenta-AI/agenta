import React, {useCallback, useState} from "react"
import {Modal} from "antd"
import {useAppsData} from "@/contexts/app.context"
import {deleteApp} from "@/services/app-selector/api"
import {ListAppsItem} from "@/lib/Types"

interface DeleteAppModalProps extends React.ComponentProps<typeof Modal> {
    appDetails: ListAppsItem
}

const DeleteAppModal = ({appDetails, ...props}: DeleteAppModalProps) => {
    const [confirmLoading, setConfirmLoading] = useState(false)
    const {mutate} = useAppsData()

    const handleDeleteOk = useCallback(async () => {
        setConfirmLoading(true)
        try {
            const res = await deleteApp(appDetails.app_id)
            await mutate()
        } catch (error) {
            console.error(error)
        } finally {
            // remove variant tabs position index from LS
            localStorage.removeItem(`tabIndex_${appDetails.app_id}`)
            props.onCancel?.({} as any)
            setConfirmLoading(false)
        }
    }, [appDetails, mutate, props])

    return (
        <Modal
            title="Are you sure?"
            confirmLoading={confirmLoading}
            okText="Yes"
            cancelText="No"
            onOk={handleDeleteOk}
            {...props}
        >
            <p>Are you sure you want to delete {appDetails.app_name}?</p>
        </Modal>
    )
}

export default DeleteAppModal
