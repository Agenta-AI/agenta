import {Modal, Tag, Typography} from "antd"

import {TestsetColumn} from "../assets/types"

interface ConfirmSaveModalProps {
    isConfirmSave: boolean
    setIsConfirmSave: (value: boolean) => void
    onSaveTestset: (onCloseCallback?: () => void) => Promise<void>
    onClose?: () => void
    isLoading: boolean
    isTestsetsLoading: boolean
    testsetName: string
    selectedTestsetColumns: TestsetColumn[]
}

export function ConfirmSaveModal({
    isConfirmSave,
    setIsConfirmSave,
    onSaveTestset,
    onClose,
    isLoading,
    isTestsetsLoading,
    testsetName,
    selectedTestsetColumns,
}: ConfirmSaveModalProps) {
    const newColumns = selectedTestsetColumns.filter((item) => item.isNew).map((item) => item.column)

    return (
        <Modal
            open={isConfirmSave}
            onCancel={() => setIsConfirmSave(false)}
            title="Add new columns to testset"
            okText="Confirm"
            onOk={() => onSaveTestset(onClose)}
            confirmLoading={isLoading || isTestsetsLoading}
            zIndex={2000}
            centered
        >
            <div className="flex flex-col gap-4 my-4">
                <Typography.Text>
                    You are about to add new columns to the{" "}
                    <span className="font-bold">{testsetName}</span> testset. This will create a new
                    revision.
                </Typography.Text>

                <div className="flex flex-col gap-2">
                    <Typography.Text type="secondary">New columns:</Typography.Text>
                    <div className="flex flex-wrap gap-1">
                        {newColumns.map((col) => (
                            <Tag key={col} color="blue">
                                {col}
                            </Tag>
                        ))}
                    </div>
                </div>
            </div>
        </Modal>
    )
}
