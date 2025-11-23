import {Input, Tag, Typography} from "antd"

import {RenameEvalModalContentProps} from "../../types"

const RenameEvalModalContent = ({
    loading,
    error,
    currentName,
    editName,
    setEditName,
    editDescription,
    setEditDescription,
}: RenameEvalModalContentProps) => {
    return (
        <section className="flex flex-col gap-3 py-1">
            <div className="flex flex-col gap-1">
                <Typography.Text className=" font-medium">Evaluation</Typography.Text>
                <Tag color="blue" className=" self-start">
                    {currentName}
                </Tag>
            </div>

            <div className="flex flex-col gap-1">
                <Typography.Text className="font-medium">Rename to</Typography.Text>
                <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={100}
                    placeholder="Enter new name"
                    disabled={loading}
                    className="rounded-lg"
                />
            </div>

            <div className="flex flex-col gap-1">
                <Typography.Text className="font-medium">Description</Typography.Text>
                <Input.TextArea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder="Add description (optional)"
                    disabled={loading}
                    className="rounded-lg"
                />
            </div>

            {error && <Typography.Text type="danger">{error}</Typography.Text>}
        </section>
    )
}

export default RenameEvalModalContent
