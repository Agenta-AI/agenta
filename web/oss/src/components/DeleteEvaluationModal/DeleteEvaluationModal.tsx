import {DeleteOutlined} from "@ant-design/icons"
import {ModalProps, Typography} from "antd"

import EnhancedModal from "../EnhancedUIs/Modal"

interface DeleteAutoEvalModalProps extends ModalProps {
    evaluationType: string
}

const DeleteEvaluationModal = ({evaluationType, ...props}: DeleteAutoEvalModalProps) => {
    return (
        <EnhancedModal
            {...props}
            okText={"Delete"}
            okType="danger"
            okButtonProps={{icon: <DeleteOutlined />, type: "primary"}}
            centered
            zIndex={2000}
        >
            <section className="flex flex-col gap-1">
                <Typography.Text className="text-sm font-semibold mb-2">
                    Are you sure you want to delete?
                </Typography.Text>

                <div className="flex flex-col gap-4">
                    <Typography.Text>
                        A deleted {evaluationType} cannot be restored.
                    </Typography.Text>

                    <div className="flex flex-col gap-1">
                        <Typography.Text>You are about to delete:</Typography.Text>
                        <Typography.Text className="text-sm font-medium capitalize">
                            {evaluationType}
                        </Typography.Text>
                    </div>
                </div>
            </section>
        </EnhancedModal>
    )
}

export default DeleteEvaluationModal
