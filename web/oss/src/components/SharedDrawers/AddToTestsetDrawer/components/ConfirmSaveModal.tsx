import {Input, Modal, Typography} from "antd"

import {TestsetColumn} from "../assets/types"

interface ConfirmSaveModalProps {
    isConfirmSave: boolean
    setIsConfirmSave: (value: boolean) => void
    onSaveTestset: () => Promise<void>
    isLoading: boolean
    isTestsetsLoading: boolean
    testsetName: string
    selectedTestsetColumns: TestsetColumn[]
    isNewTestset: boolean
    commitMessage: string
    setCommitMessage: (message: string) => void
    availableRevisions: {id: string; version: number | null}[]
}

export function ConfirmSaveModal({
    isConfirmSave,
    setIsConfirmSave,
    onSaveTestset,
    isLoading,
    isTestsetsLoading,
    testsetName,
    selectedTestsetColumns,
    isNewTestset,
    commitMessage,
    setCommitMessage,
    availableRevisions,
}: ConfirmSaveModalProps) {
    return (
        <Modal
            open={isConfirmSave}
            onCancel={() => setIsConfirmSave(false)}
            title="Save changes to testset"
            okText="Confirm"
            onOk={() => onSaveTestset()}
            confirmLoading={isLoading || isTestsetsLoading}
            zIndex={2000}
            centered
        >
            <div className="flex flex-col gap-4 my-4">
                <Typography.Text>
                    You have created new columns. Do you want to add them to the{" "}
                    <span className="font-bold">{testsetName}</span> testset?
                </Typography.Text>

                <div className="flex gap-1">
                    New columns:{" "}
                    {JSON.stringify(
                        selectedTestsetColumns
                            .filter((item) => item.isNew)
                            .map((item) => item.column),
                    )}
                </div>

                {!isNewTestset && (
                    <div className="flex flex-col gap-2">
                        <Typography.Text strong>Commit message (optional):</Typography.Text>
                        <Input.TextArea
                            placeholder="Describe your changes..."
                            value={commitMessage}
                            onChange={(e) => setCommitMessage(e.target.value)}
                            rows={3}
                            maxLength={500}
                        />
                        <Typography.Text type="secondary" className="text-xs">
                            This will create a new revision (v
                            {(availableRevisions[0]?.version ?? 0) + 1})
                        </Typography.Text>
                    </div>
                )}
            </div>
        </Modal>
    )
}
