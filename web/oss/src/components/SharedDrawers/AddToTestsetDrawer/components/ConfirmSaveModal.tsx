import {EnhancedModal} from "@agenta/ui/components/modal"
import {Tag} from "antd"

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
    const newColumns = selectedTestsetColumns
        .filter((item) => item.isNew)
        .map((item) => item.column)

    return (
        <EnhancedModal
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
                <span>
                    You are about to add new columns to the{" "}
                    <span className="font-bold">{testsetName}</span> testset. This will create a new
                    revision.
                </span>

                <div className="flex flex-col gap-2">
                    <span className="text-muted-foreground">New columns:</span>
                    <div className="flex flex-wrap gap-1">
                        {newColumns.map((col) => (
                            <Tag key={col} color="blue">
                                {col}
                            </Tag>
                        ))}
                    </div>
                </div>
            </div>
        </EnhancedModal>
    )
}
