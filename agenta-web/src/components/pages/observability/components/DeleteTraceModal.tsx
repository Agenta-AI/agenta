import {DeleteOutlined} from "@ant-design/icons"
import {Modal} from "antd"
import React from "react"

type DeleteTraceModalProps = {
    setSelectedTraceId: (val: string) => void
} & React.ComponentProps<typeof Modal>

const DeleteTraceModal = ({setSelectedTraceId, ...props}: DeleteTraceModalProps) => {
    return (
        <Modal
            centered
            destroyOnClose
            width={380}
            title={"Are you sure you want to delete?"}
            okButtonProps={{icon: <DeleteOutlined />, danger: true}}
            okText={"Delete"}
            {...props}
        >
            This action is not reversible.
        </Modal>
    )
}

export default DeleteTraceModal
