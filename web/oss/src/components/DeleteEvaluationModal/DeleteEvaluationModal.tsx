import EnhancedModal from "@agenta/oss/src/components/EnhancedUIs/Modal"
import {DeleteOutlined} from "@ant-design/icons"
import {Typography} from "antd"

import {DeleteEvaluationModalProps} from "./types"

const DeleteEvaluationModal = ({
    evaluationType,
    isMultiple = false,
    ...props
}: DeleteEvaluationModalProps) => {
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
                        {isMultiple
                            ? `The selected ${evaluationType.split("|").length} evaluations will be permanently deleted.`
                            : `A deleted ${evaluationType} cannot be restored.`}
                    </Typography.Text>

                    <div className="flex flex-col gap-1">
                        <Typography.Text>
                            {isMultiple
                                ? "You are about to delete the following evaluations:"
                                : "You are about to delete:"}
                        </Typography.Text>
                        <Typography.Text
                            className={`text-sm font-medium ${
                                isMultiple ? "max-h-40 overflow-y-auto" : ""
                            }`}
                        >
                            {isMultiple
                                ? evaluationType.split(" | ").map((item, index) => (
                                      <div key={index} className="py-1">
                                          • {item.trim()}
                                      </div>
                                  ))
                                : evaluationType}
                        </Typography.Text>
                    </div>
                </div>
            </section>
        </EnhancedModal>
    )
}

export default DeleteEvaluationModal
