import React from "react"
import {Modal} from "antd"

type DeleteAppModalProps = {
    appName: string
    confirmLoading: boolean
} & React.ComponentProps<typeof Modal>

const DeleteAppModal = ({appName, confirmLoading, ...props}: DeleteAppModalProps) => {
    return (
        <Modal
            title="Are you sure?"
            confirmLoading={confirmLoading}
            okText="Yes"
            cancelText="No"
            {...props}
        >
            <p>Are you sure you want to delete {appName}?</p>
        </Modal>
    )
}

export default DeleteAppModal
