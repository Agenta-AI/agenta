import {useCallback, useState} from "react"

import {Modal} from "antd"

import {useAppsData} from "@/oss/contexts/app.context"
import {ListAppsItem} from "@/oss/lib/Types"
import {deleteApp} from "@/oss/services/app-selector/api"

interface DeleteAppModalProps extends React.ComponentProps<typeof Modal> {
    appDetails: ListAppsItem
}

const DeleteAppModal = ({appDetails, ...props}: DeleteAppModalProps) => {
    const [confirmLoading, setConfirmLoading] = useState(false)
    const {mutate} = useAppsData()

    const handleDeleteOk = useCallback(async () => {
        setConfirmLoading(true)
        try {
            await deleteApp(appDetails.app_id)
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
