import React from "react"
import {Modal} from "antd"

interface Props {
    isModalOpen: boolean
    setIsModalOpen: (value: boolean) => void
}

const TestSetMusHaveNameModal: React.FC<Props> = ({
    isModalOpen,
    setIsModalOpen,
}) => {
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
            <p>
                You cannot create/update a test set with an empty name. 
                Please provide a descriptive name before proceeding.
            </p>
        </Modal>
    )
}

export default TestSetMusHaveNameModal
