import {JSSTheme} from "@/lib/Types"
import {ExclamationCircleOutlined} from "@ant-design/icons"
import {Modal, Typography} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"

interface EvaluationErrorModalProps {
    isErrorModalOpen: boolean
    setIsErrorModalOpen: (value: React.SetStateAction<boolean>) => void
    modalErrorMsg: {
        message: string
        stackTrace: string
    }
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    errModalStackTrace: {
        "& code": {
            display: "block",
        },
    },
}))

const EvaluationErrorModal = ({
    isErrorModalOpen,
    setIsErrorModalOpen,
    modalErrorMsg,
}: EvaluationErrorModalProps) => {
    const classes = useStyles()

    return (
        <Modal
            open={isErrorModalOpen}
            footer={null}
            destroyOnClose
            title={
                <>
                    <ExclamationCircleOutlined className="text-red-500 mr-2 mb-3" />
                    Error
                </>
            }
            onCancel={() => setIsErrorModalOpen(false)}
        >
            <Typography.Paragraph>
                Failed to invoke the LLM application with the following exception:
            </Typography.Paragraph>
            {modalErrorMsg.message && (
                <Typography.Paragraph type="danger" strong>
                    {modalErrorMsg.message}
                </Typography.Paragraph>
            )}
            {modalErrorMsg.stackTrace && (
                <Typography.Paragraph code className={classes.errModalStackTrace}>
                    {modalErrorMsg.stackTrace}
                </Typography.Paragraph>
            )}
        </Modal>
    )
}

export default EvaluationErrorModal
