import React from "react"
import {Modal} from "antd"
import {ExclamationCircleOutlined} from "@ant-design/icons"

interface Props {
    isModalOpen: boolean
    setIsModalOpen: (value: boolean) => void
}

const testsetMusHaveNameModal: React.FC<Props> = ({isModalOpen, setIsModalOpen}) => {
    const handleCloseModal = () => setIsModalOpen(false)

    const handleDismiss = () => {
        handleCloseModal()
    }

    return (
        <Modal
            title="Test Set Name Required"
            open={isModalOpen}
            onCancel={handleDismiss}
            centered
            footer={null}
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                }}
            >
                <ExclamationCircleOutlined
                    style={{fontSize: "24px", color: "#faad14", marginRight: "10px"}}
                />
                <p data-cy="testset-name-reqd-error">
                    You cannot create/update a test set with an empty name. Please provide a
                    descriptive name before proceeding.
                </p>
            </div>
        </Modal>
    )
}

export default testsetMusHaveNameModal
