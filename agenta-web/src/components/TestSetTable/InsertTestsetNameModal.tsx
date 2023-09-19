import React from "react"
import {Modal} from "antd"
import {ExclamationCircleOutlined} from "@ant-design/icons"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles({
    modalContainer: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
    },
    modalIcon: {
        fontSize: "24px",
        color: "#faad14",
        marginRight: "10px",
    },
})

interface Props {
    isModalOpen: boolean
    setIsModalOpen: (value: boolean) => void
}

const TestsetMusHaveNameModal: React.FC<Props> = ({isModalOpen, setIsModalOpen}) => {
    const classes = useStyles()
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
            <div className={classes.modalContainer}>
                <ExclamationCircleOutlined className={classes.modalIcon} />
                <p data-cy="testset-name-reqd-error">
                    You cannot create/update a test set with an empty name. Please provide a
                    descriptive name before proceeding.
                </p>
            </div>
        </Modal>
    )
}

export default TestsetMusHaveNameModal
