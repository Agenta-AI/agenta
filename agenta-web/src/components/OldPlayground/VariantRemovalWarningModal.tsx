import React from "react"
import {Modal, Button} from "antd"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles({
    modalBtnContainer: {
        display: "flex",
        justifyContent: "flex-end",
    },
    cancelBtn: {
        marginRight: 10,
    },
})

interface Props {
    isModalOpen: boolean
    setIsModalOpen: (value: boolean) => void
    handleRemove: () => void
    handleCancel: () => void
}

const VariantRemovalWarningModal: React.FC<Props> = ({
    isModalOpen,
    setIsModalOpen,
    handleRemove,
    handleCancel,
}) => {
    const classes = useStyles()
    const handleCloseModal = () => setIsModalOpen(false)
    const router = useRouter()

    const handleDelete = () => {
        handleRemove()
        handleCloseModal()
    }

    const handleDismiss = () => {
        handleCancel()
        handleCloseModal()
    }

    return (
        <Modal
            title="Delete Variant"
            open={isModalOpen}
            onCancel={handleDismiss}
            footer={null}
            centered
        >
            <p>You're about to delete this variant. This action is irreversible.</p>
            <p>Are you sure you want to proceed?</p>
            <div className={classes.modalBtnContainer}>
                <Button onClick={handleDismiss} className={classes.cancelBtn}>
                    Cancel
                </Button>
                <Button type="primary" danger onClick={handleDelete}>
                    Delete
                </Button>
            </div>
        </Modal>
    )
}

export default VariantRemovalWarningModal
