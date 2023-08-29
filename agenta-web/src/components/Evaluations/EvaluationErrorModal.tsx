import React from "react"
import {Modal, Button} from "antd"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles({
    container: {
        display: "flex",
        justifyContent: "flex-end",
        gap: 10,
    },
})

interface Props {
    isModalOpen: boolean
    handleNavigate: () => void
    message: string
    btnText: string
    onClose: () => void
}

const EvaluationErrorModal: React.FC<Props> = ({
    isModalOpen,
    handleNavigate,
    message,
    btnText,
    onClose,
}) => {
    const classes = useStyles()
    const handleCloseModal = () => onClose()

    const handleCTAClick = () => {
        handleNavigate()
        handleCloseModal()
    }

    return (
        <Modal title="Error" open={isModalOpen} onCancel={handleCloseModal} footer={null} centered>
            <p>{message}</p>
            <div className={classes.container}>
                <Button onClick={handleCloseModal}>Ok</Button>
                <Button type="primary" onClick={handleCTAClick}>
                    {btnText}
                </Button>
            </div>
        </Modal>
    )
}

export default EvaluationErrorModal
