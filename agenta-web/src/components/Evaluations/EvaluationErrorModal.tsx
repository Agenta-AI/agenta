import React, {Dispatch, SetStateAction} from "react"
import {Modal, Button} from "antd"

interface Props {
    isModalOpen: boolean
    handleNavigate: () => void
    message: string
    btnText: string
    closeBtnText: Dispatch<SetStateAction<string>>
    closeEvalutionError: Dispatch<SetStateAction<string>>
    closeEndpoint: Dispatch<SetStateAction<string>>
}

const EvaluationErrorModal: React.FC<Props> = ({
    isModalOpen,
    handleNavigate,
    message,
    btnText,
    closeBtnText,
    closeEvalutionError,
    closeEndpoint,
}) => {
    const handleCloseModal = () => {
        closeBtnText("")
        closeEvalutionError("")
        closeEndpoint("")
    }

    const handleCTAClick = () => {
        handleNavigate()
        handleCloseModal()
    }

    return (
        <Modal title="Error" open={isModalOpen} onCancel={handleCloseModal} footer={null} centered>
            <p>{message}</p>
            <div style={{display: "flex", justifyContent: "flex-end"}}>
                <Button onClick={handleCloseModal} style={{marginRight: 10}}>
                    Ok
                </Button>
                <Button type="primary" onClick={handleCTAClick}>
                    {btnText}
                </Button>
            </div>
        </Modal>
    )
}

export default EvaluationErrorModal
