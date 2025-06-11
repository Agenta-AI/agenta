import {ExclamationCircleOutlined} from "@ant-design/icons"
import {Collapse, Modal, Typography, theme} from "antd"
import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

interface EvaluationErrorModalProps {
    isErrorModalOpen: boolean
    setIsErrorModalOpen: (value: React.SetStateAction<boolean>) => void
    modalErrorMsg: {
        message: string
        stackTrace: string
        errorType: "invoke" | "evaluation"
    }
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    errModalStackTrace: {
        "& code": {
            display: "block",
            whiteSpace: "pre-wrap",
        },
        maxHeight: 300,
        overflow: "auto",
    },
}))

const EvaluationErrorModal = ({
    isErrorModalOpen,
    setIsErrorModalOpen,
    modalErrorMsg,
}: EvaluationErrorModalProps) => {
    const classes = useStyles()

    const errorText =
        modalErrorMsg.errorType === "invoke"
            ? "Failed to invoke the LLM application with the following exception:"
            : "Failed to compute evaluation with the following exception:"

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
            <Typography.Paragraph>{errorText}</Typography.Paragraph>
            {modalErrorMsg.message && (
                <Typography.Paragraph type="danger">
                    {modalErrorMsg.message}
                </Typography.Paragraph>
            )}
            {modalErrorMsg.stackTrace && (
                <Collapse
                    ghost
                    items={[
                        {
                            key: "1",
                            label: "Traceback",
                            children: (
                                <Typography.Paragraph code className={classes.errModalStackTrace}>
                                    {modalErrorMsg.stackTrace}
                                </Typography.Paragraph>
                            ),
                        },
                    ]}
                />
            )}
        </Modal>
    )
}

export default EvaluationErrorModal
