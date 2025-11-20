import {Input, Typography} from "antd"
import {RenameEvalModalContentProps} from "../../types"

const RenameEvalModalContent = ({
    loading,
    error,
    editName,
    setEditName,
    editDescription,
    setEditDescription,
}: RenameEvalModalContentProps) => {
    return (
        <section className="flex flex-col gap-2 my-4">
            <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={100}
                placeholder="Run name"
                disabled={loading}
            />
            <Input.TextArea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Description (optional)"
                disabled={loading}
            />
            {error && <Typography.Text type="danger">{error}</Typography.Text>}
        </section>
    )
}

export default RenameEvalModalContent
